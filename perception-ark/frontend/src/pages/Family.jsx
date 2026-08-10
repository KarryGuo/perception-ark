import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useSpeechSynthesis, useSpeechRecognition } from '../hooks/useSpeech.js';
import FamilyMap from '../components/FamilyMap.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

// 顶部药丸Tab(与视障端统一框架)
const TABS = [
  { key: 'overview', label: '守护' },
  { key: 'safety', label: '安全' },
  { key: 'routes', label: '路线' },
  { key: 'users', label: '我的' },
];

export default function Family() {
  const { user: currentUser, logout } = useAuth();
  const { speak } = useSpeechSynthesis();
  const { start: asrStart, stop: asrStop, reset: asrReset, transcript: asrText, listening: asrListening, supported: asrSupported } = useSpeechRecognition();
  const [dashboard, setDashboard] = useState(null);
  const [sosEvents, setSosEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [recognitionHistory, setRecognitionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null); // null=添加模式, 数字=编辑模式
  const [editingBindingSource, setEditingBindingSource] = useState(null); // 编辑时用户来源(invitation/手动)
  const [formData, setFormData] = useState({
    name: '', age: '', relation: '', phone: '',
    emergency_contact: '', emergency_phone: '', health_notes: '',
    bind_phone: ''
  });
  const [liveAlert, setLiveAlert] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [formError, setFormError] = useState(null); // 表单错误提示(如:该账号未注册)
  const [formInfo, setFormInfo] = useState(null); // 表单成功提示(如:邀请已发送待确认)
  const [preciseLocation, setPreciseLocation] = useState(null); // 视障人员精确位置(家属可见)

  // ===== 待确认邀请(视障端发起,等待家属确认) =====
  const [pendingConfirmList, setPendingConfirmList] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [currentConfirmItem, setCurrentConfirmItem] = useState(null);
  const [confirmProcessing, setConfirmProcessing] = useState(false);
  const announcedIdsRef = useRef(new Set()); // 已语音播报过的邀请ID,避免重复播报

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [dash, sos, contactList, routeData, recog] = await Promise.all([
        api.familyDashboard().catch(() => null),
        api.familySos().catch(() => ({ events: [] })),
        api.familyContacts().catch(() => ({ contacts: [] })),
        api.familyRoutes().catch(() => ({ routes: [] })),
        api.familyRecognitionHistory(50).catch(() => ({ events: [] })),
      ]);
      if (dash) setDashboard(dash);
      setSosEvents(sos?.events || []);
      setContacts(contactList?.contacts || []);
      setRoutes(routeData?.routes || []);
      setRecognitionHistory(recog?.events || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.familyUsers();
      setUsers(data.users || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // 加载视障人员精确位置(家属监护人可见,用于实时地图显示)
  const loadPreciseLocation = useCallback(async () => {
    try {
      const data = await api.familyPreciseLocation();
      if (data?.location) {
        setPreciseLocation(data);
      }
    } catch (err) {
      // 静默失败,不打扰用户
    }
  }, []);

  // 加载待确认邀请(视障端发起,等待家属确认)
  const loadPendingConfirm = useCallback(async () => {
    try {
      const res = await api.familyPendingConfirm();
      if (res?.success && Array.isArray(res.list)) {
        setPendingConfirmList(res.list);
        // 对新出现的邀请进行语音播报提示(仅在非编辑表单状态,避免干扰)
        res.list.forEach(item => {
          if (!announcedIdsRef.current.has(item.id)) {
            announcedIdsRef.current.add(item.id);
            const viName = item.user_nickname || item.user_username || item.user_phone || '视障人员';
            const relation = item.relation || '家属';
            const phoneText = item.user_phone ? `,对方手机号${item.user_phone}` : '';
            speak(`收到来自${viName}的绑定邀请,关系为${relation}${phoneText}。请确认是否绑定。说"确认绑定"或点击确认按钮,说"拒绝"或点击拒绝按钮。`, { urgent: true });
          }
        });
      }
    } catch (err) {
      console.warn('[Family] 加载待确认邀请失败:', err.message);
    }
  }, [speak]);

  // 确认视障端发起的邀请
  const handleConfirmInvitation = useCallback(async (bindingId) => {
    setConfirmProcessing(true);
    try {
      const res = await api.familyConfirmInvitation(bindingId);
      if (res?.success) {
        speak('已确认绑定');
        setShowConfirmModal(false);
        setCurrentConfirmItem(null);
        asrStop();
        announcedIdsRef.current.delete(bindingId);
        loadPendingConfirm();
        loadUsers();
      } else {
        setFormError(res?.error || '确认失败');
      }
    } catch (err) {
      setFormError(`确认失败: ${err.message}`);
    } finally {
      setConfirmProcessing(false);
    }
  }, [speak, asrStop, loadPendingConfirm, loadUsers]);

  // 拒绝视障端发起的邀请
  const handleRejectInvitation = useCallback(async (bindingId) => {
    setConfirmProcessing(true);
    try {
      const res = await api.familyRejectInvitation(bindingId);
      if (res?.success) {
        speak('已拒绝邀请');
        setShowConfirmModal(false);
        setCurrentConfirmItem(null);
        asrStop();
        announcedIdsRef.current.delete(bindingId);
        loadPendingConfirm();
      } else {
        setFormError(res?.error || '拒绝失败');
      }
    } catch (err) {
      setFormError(`拒绝失败: ${err.message}`);
    } finally {
      setConfirmProcessing(false);
    }
  }, [speak, asrStop, loadPendingConfirm]);

  // 打开确认对话框并启动ASR监听
  const openConfirmModal = useCallback((item) => {
    setCurrentConfirmItem(item);
    setShowConfirmModal(true);
    setFormError(null);
    asrReset();
    if (asrSupported) {
      asrStart();
    }
  }, [asrReset, asrSupported, asrStart]);

  useEffect(() => {
    loadData();
    loadUsers();
    loadPendingConfirm();
    loadPreciseLocation();
    const interval = setInterval(() => {
      loadData(true);
      loadUsers();
      loadPendingConfirm();
      loadPreciseLocation();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData, loadUsers, loadPendingConfirm, loadPreciseLocation]);

  // ASR 语音指令监听: 当确认对话框打开时,识别"确认绑定"/"拒绝"指令
  useEffect(() => {
    if (!showConfirmModal || !currentConfirmItem || !asrText) return;
    const text = asrText.trim();
    if (/^(确认|确认绑定|同意|好的|确定)/.test(text)) {
      handleConfirmInvitation(currentConfirmItem.id);
      asrReset();
    } else if (/^(拒绝|拒绝绑定|不同意|取消|不要)/.test(text)) {
      handleRejectInvitation(currentConfirmItem.id);
      asrReset();
    }
  }, [asrText, showConfirmModal, currentConfirmItem, handleConfirmInvitation, handleRejectInvitation, asrReset]);

  // 组件卸载时停止ASR
  useEffect(() => {
    return () => {
      if (asrListening) asrStop();
    };
  }, [asrListening, asrStop]);

  const { connected } = useWebSocket(useCallback((event) => {
    if (event.type === 'sos') {
      setLiveAlert({ title: event.title, sub: event.sub, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
      loadData();
      setTimeout(() => setLiveAlert(null), 10000);
    }
    if (event.type === 'alert' || event.type === 'subtitle' || event.type === 'safety_result') {
      loadData();
    }
  }, [loadData]));

  const handleAddUser = useCallback(async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setFormError(null); // 清除上次的错误提示
    setFormInfo(null);
    try {
      const payload = {
        ...formData,
        age: formData.age ? parseInt(formData.age) : null
      };
      if (editingUserId) {
        // 编辑模式
        await api.familyUpdateUser(editingUserId, payload);
        // 编辑保存后同时刷新dashboard(守护页)和users列表(我的页)
        loadData();
        loadUsers();
        setFormInfo('已保存修改');
        // 延迟关闭表单,让用户看到成功提示
        setTimeout(() => {
          setFormData({ name: '', age: '', relation: '', phone: '', emergency_contact: '', emergency_phone: '', health_notes: '', bind_phone: '' });
          setShowAddForm(false);
          setEditingUserId(null);
          setEditingBindingSource(null);
          setFormInfo(null);
        }, 1000);
        return;
      } else {
        // 添加模式: 处理后端返回的绑定状态(needsConfirm/autoActivated)
        const res = await api.familyAddUser(payload);
        if (res?.success && formData.bind_phone?.trim()) {
          // 填写了绑定手机号,根据后端返回状态提示
          if (res.autoActivated) {
            setFormInfo('双方互邀请,绑定成功');
            speak('双方互邀请,绑定成功');
          } else if (res.needsConfirm) {
            setFormInfo('已发送邀请,等待视障用户确认后绑定生效');
            speak('已发送邀请,等待视障用户确认后绑定生效');
          } else if (res.bindStatus === 'active') {
            setFormInfo('绑定成功');
            speak('绑定成功');
          } else if (res.message) {
            setFormInfo(res.message);
          }
        } else if (res?.success) {
          setFormInfo('已添加使用者');
        }
      }
      setFormData({ name: '', age: '', relation: '', phone: '', emergency_contact: '', emergency_phone: '', health_notes: '', bind_phone: '' });
      setShowAddForm(false);
      setEditingUserId(null);
      loadUsers();
    } catch (err) {
      // 捕获后端返回的错误,特别是"该账号未注册"提示
      const errMsg = err.message || '';
      if (errMsg.includes('未注册') || errMsg.includes('该账号')) {
        setFormError(`该账号未注册,请确认手机号正确且对方已注册视障人员账号`);
      } else {
        setFormError(`${editingUserId ? '编辑' : '添加'}失败: ${errMsg}`);
      }
    }
  }, [formData, editingUserId, loadUsers, loadData, speak]);

  // 点击编辑使用者: 预填表单数据并进入编辑模式
  const handleEditUser = useCallback((u) => {
    setEditingUserId(u.id);
    setEditingBindingSource(u.binding_source || null); // 记录用户来源(邀请绑定/手动添加)
    setFormData({
      name: u.name || '',
      age: u.age != null ? String(u.age) : '',
      relation: u.relation || '',
      phone: u.phone || '',
      emergency_contact: u.emergency_contact || '',
      emergency_phone: u.emergency_phone || '',
      health_notes: u.health_notes || '',
      bind_phone: undefined // 编辑时不传bind_phone,避免误触发解绑
    });
    setShowAddForm(true);
  }, []);

  // 取消表单(添加/编辑通用)
  const handleCancelForm = useCallback(() => {
    setShowAddForm(false);
    setEditingUserId(null);
    setEditingBindingSource(null);
    setFormError(null);
    setFormData({ name: '', age: '', relation: '', phone: '', emergency_contact: '', emergency_phone: '', health_notes: '', bind_phone: '' });
  }, []);

  const handleDeleteUser = useCallback(async (id, name) => {
    if (!confirm(`确定删除使用者"${name}"？`)) return;
    try {
      await api.familyDeleteUser(id);
      loadUsers();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  }, [loadUsers]);

  // ===== 加载中(复用am-app框架) =====
  if (loading) {
    return (
      <div className="am-app">
        <div className="am-bg-layer">
          <div className="am-bg-sos" />
          <div className="am-overlay" />
        </div>
        <div className="am-fam-loading">
          <div className="am-fam-loading-icon">⏳</div>
          <div className="am-fam-loading-text">加载家属端...</div>
        </div>
      </div>
    );
  }

  // ===== 加载失败 =====
  if (error) {
    return (
      <div className="am-app">
        <div className="am-bg-layer">
          <div className="am-bg-sos" />
          <div className="am-overlay" />
        </div>
        <div className="am-fam-loading">
          <div className="am-fam-loading-icon" style={{ animation: 'none' }}>❌</div>
          <div className="am-fam-loading-text" style={{ color: 'var(--bio-magenta)' }}>加载失败: {error}</div>
          <div className="am-fam-loading-hint">请确保后端服务已启动</div>
          <button className="am-fam-retry-btn" onClick={() => loadData()}>重试</button>
        </div>
      </div>
    );
  }

  const stats = dashboard?.stats || {};
  const user = dashboard?.user || {};
  const agents = dashboard?.agents || {};
  const topRoutes = dashboard?.topRoutes || [];
  const recentRecognitions = dashboard?.recentRecognitions || [];
  const recentSafety = dashboard?.recentSafety || [];
  const recentSos = dashboard?.recentSos || [];

  return (
    <div className="am-app">
      {/* ===== 全屏背景层(渐变,与视障端统一) ===== */}
      <div className="am-bg-layer">
        <div className="am-bg-sos" />
        <div className="am-overlay" />
      </div>

      {/* ===== 顶部浮动药丸Tab栏(与视障端统一) ===== */}
      <div className="am-top-tabs am-fam-tabs" role="tablist" aria-label="主导航">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`am-tab-pill ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-label={tab.label}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ===== 右上角浮动工具栏(与视障端统一) ===== */}
      <div className="am-top-tools">
        <div className="am-status">
          <span className={`am-dot ${connected ? 'on' : 'off'}`} />
          <span className="am-status-text">{connected ? '在线' : '离线'}</span>
        </div>
        <ThemeToggle size="sm" />
      </div>

      {/* ===== SOS实时告警浮层 ===== */}
      {liveAlert && (
        <div className="am-fam-sos-alert" role="alert">
          <div className="am-fam-sos-title">🚨 {liveAlert.title}</div>
          <div className="am-fam-sos-sub">{liveAlert.sub}</div>
          <div className="am-fam-sos-time">{liveAlert.time}</div>
        </div>
      )}

      {/* ===== 刷新指示器 ===== */}
      {refreshing && (
        <div className="am-fam-refresh">
          <span className="am-fam-refresh-dot" /> 正在刷新数据...
        </div>
      )}

      {/* ===== 主内容浮层(可滚动) ===== */}
      <div className="am-content-layer am-fam-content">
        {/* === 守护Tab === */}
        {activeTab === 'overview' && (
          <>
            <GuardianCard user={user} />

            {/* 实时位置小地图 */}
            <FamCard title="实时位置" icon="📍" color="cyan">
              <FamilyMap
                location={preciseLocation?.location}
                activity={preciseLocation?.activity || user?.activity}
                online={user?.online}
              />
              {preciseLocation?.lastUpdate && (
                <div className="am-fam-loc-update">
                  最后更新: {new Date(preciseLocation.lastUpdate).toLocaleString('zh-CN')}
                </div>
              )}
            </FamCard>

            <div className="am-fam-stat-grid">
              <FamStat icon="👁️" label="识别" value={stats.totalRecognitions || 0} color="emerald" />
              <FamStat icon="🛡️" label="安全" value={stats.totalSafetyChecks || 0} color="cyan" />
              <FamStat icon="⚠️" label="预警" value={stats.dangerCount || 0} color="magenta" />
              <FamStat icon="🚨" label="SOS" value={stats.todaySos || 0} color="amber" />
            </div>

            <FamCard title="智能体状态" icon="🤖" color="cyan">
              <div className="am-fam-agent-list">
                {Object.entries(agents).map(([id, info]) => (
                  <div key={id} className={`am-fam-agent-item ${info.active ? 'active' : ''}`}>
                    <div className="am-fam-agent-info">
                      <div className="am-fam-agent-name">{info.name}</div>
                      <div className="am-fam-agent-id">{id} · P{info.priority}</div>
                    </div>
                    <span className={`am-fam-agent-badge ${info.active ? 'on' : 'off'}`}>
                      {info.active ? '● 运行' : '○ 待机'}
                    </span>
                  </div>
                ))}
              </div>
            </FamCard>

            <FamCard title="最近识别" icon="👁️" color="emerald" badge={recentRecognitions.length}>
              {recentRecognitions.length === 0 ? (
                <FamEmpty text="暂无识别记录" />
              ) : (
                <div className="am-fam-recog-list">
                  {recentRecognitions.slice(0, 5).map((evt, i) => {
                    const text = evt.text || evt.message || '';
                    const time = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '';
                    return (
                      <div key={i} className="am-fam-recog-item">
                        <span className="am-fam-recog-text">{text}</span>
                        <span className="am-fam-recog-time">{time}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </FamCard>

            <FamCard title="最近SOS" icon="🚨" color="magenta" badge={recentSos.length}>
              {recentSos.length === 0 ? (
                <FamEmpty text="✓ 暂无SOS事件" />
              ) : (
                <div className="am-fam-sos-list">
                  {recentSos.slice(0, 5).map(evt => (
                    <div key={evt.id} className="am-fam-sos-item">
                      <span className="am-fam-sos-type">
                        {evt.event_type === 'fall' ? '⚠ 跌倒检测' : `🚨 ${evt.event_type}`}
                      </span>
                      <span className="am-fam-sos-time">
                        {new Date(evt.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </FamCard>
          </>
        )}

        {/* === 安全Tab === */}
        {activeTab === 'safety' && (
          <>
            <FamCard title="安全预警记录" icon="🛡️" color="magenta" badge={recentSafety.length}>
              {recentSafety.length === 0 ? (
                <FamEmpty text="暂无安全预警，一切正常" />
              ) : (
                <div className="am-fam-safety-list">
                  {recentSafety.map((evt, i) => (
                    <div key={i} className="am-fam-safety-item">
                      <div className="am-fam-safety-head">
                        <span className="am-fam-safety-title">⚠️ {evt.object || '障碍物'} · {evt.direction || '正前方'}</span>
                        <span className="am-fam-safety-time">
                          {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : ''}
                        </span>
                      </div>
                      {evt.distance != null && (
                        <div className="am-fam-safety-detail">距离: {evt.distance}米</div>
                      )}
                      {evt.action && <div className="am-fam-safety-detail">建议: {evt.action}</div>}
                      {evt.traffic_light && (
                        <div className={`am-fam-safety-light ${evt.traffic_light}`}>
                          🚦 {evt.traffic_light === 'red' ? '红灯' : evt.traffic_light === 'green' ? '绿灯' : '黄灯'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </FamCard>

            <FamCard title="SOS告警历史" icon="🚨" color="amber" badge={sosEvents.length}>
              {sosEvents.length === 0 ? (
                <FamEmpty text="✓ 暂无SOS事件" />
              ) : (
                <div className="am-fam-sos-history-list">
                  {sosEvents.map(evt => (
                    <div key={evt.id} className="am-fam-sos-history-item">
                      <div className="am-fam-sos-history-head">
                        <span className="am-fam-sos-history-type">
                          {evt.event_type === 'fall' ? '⚠ 跌倒检测' : `🚨 ${evt.event_type}`}
                        </span>
                        <span className={`am-fam-sos-history-status ${evt.status}`}>
                          {evt.status === 'pending' ? '处理中' : '已通知'}
                        </span>
                      </div>
                      <div className="am-fam-sos-history-addr">📍 {evt.address || '未知位置'}</div>
                      <div className="am-fam-sos-history-time">{new Date(evt.created_at).toLocaleString('zh-CN')}</div>
                    </div>
                  ))}
                </div>
              )}
            </FamCard>
          </>
        )}

        {/* === 路线Tab === */}
        {activeTab === 'routes' && (
          <>
            <FamCard title="常用路线" icon="🗺️" color="violet" badge={topRoutes.length}>
              {topRoutes.length === 0 ? (
                <FamEmpty text="暂无常用路线" />
              ) : (
                <div className="am-fam-route-list">
                  {topRoutes.map(r => (
                    <div key={r.id} className="am-fam-route-item">
                      <div className="am-fam-route-name">{r.route_name || '未命名路线'}</div>
                      <div className="am-fam-route-meta">
                        访问 {r.visit_count} 次 · {new Date(r.last_visited).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </FamCard>

            <FamCard title="全部路线" icon="📋" color="ink" badge={routes.length}>
              {routes.length === 0 ? (
                <FamEmpty text="暂无路线记录" />
              ) : (
                <div className="am-fam-route-all-list">
                  {routes.map(r => (
                    <div key={r.id} className="am-fam-route-all-item">
                      <div>
                        <div className="am-fam-route-all-name">{r.route_name || '未命名'}</div>
                        <div className="am-fam-route-all-time">{new Date(r.last_visited).toLocaleString('zh-CN')}</div>
                      </div>
                      <span className="am-fam-route-all-count">{r.visit_count}次</span>
                    </div>
                  ))}
                </div>
              )}
            </FamCard>
          </>
        )}

        {/* === 我的Tab(使用者管理) === */}
        {activeTab === 'users' && (
          <>
            <div className="am-fam-users-header">
              <h2 className="am-fam-section-title">👥 使用者管理</h2>
              <button
                className={`am-fam-add-btn ${showAddForm ? 'cancel' : ''}`}
                onClick={() => showAddForm ? handleCancelForm() : setShowAddForm(true)}
                aria-label={showAddForm ? '取消' : '添加使用者'}
              >
                {showAddForm ? '取消' : '+ 添加'}
              </button>
            </div>

            {showAddForm && (
              <form className="am-fam-add-form" onSubmit={handleAddUser}>
                <div className="am-fam-form-title">{editingUserId ? '编辑使用者' : '添加使用者'}</div>
                {editingUserId && editingBindingSource === 'invitation' && (
                  <div className="am-fam-form-info" role="status" style={{ marginBottom: '8px' }}>
                    该使用者通过邀请绑定,仅可修改称呼和关系,其他信息由视障用户本人维护
                  </div>
                )}
                <FamFormInput placeholder="称呼 * (如:爸爸)" value={formData.name} onChange={v => setFormData({ ...formData, name: v })} required />
                <div className="am-fam-form-row">
                  <FamFormInput placeholder="年龄" type="number" value={formData.age} onChange={v => setFormData({ ...formData, age: v })} disabled={editingBindingSource === 'invitation'} />
                  <FamFormInput placeholder="关系(如:父亲)" value={formData.relation} onChange={v => setFormData({ ...formData, relation: v })} />
                </div>
                <FamFormInput placeholder="使用者手机号" value={formData.phone} onChange={v => setFormData({ ...formData, phone: v })} disabled={editingBindingSource === 'invitation'} />
                <div className="am-fam-form-row">
                  <FamFormInput placeholder="紧急联系人" value={formData.emergency_contact} onChange={v => setFormData({ ...formData, emergency_contact: v })} disabled={editingBindingSource === 'invitation'} />
                  <FamFormInput placeholder="紧急电话" value={formData.emergency_phone} onChange={v => setFormData({ ...formData, emergency_phone: v })} disabled={editingBindingSource === 'invitation'} />
                </div>
                <FamFormInput placeholder="健康备注(如:高血压)" value={formData.health_notes} onChange={v => setFormData({ ...formData, health_notes: v })} disabled={editingBindingSource === 'invitation'} />
                {!editingUserId && (
                  <FamFormInput placeholder="绑定视障人员手机号(未注册将提示)" value={formData.bind_phone || ''} onChange={v => setFormData({ ...formData, bind_phone: v })} />
                )}
                {formError && (
                  <div className="am-fam-form-error" role="alert">{formError}</div>
                )}
                {formInfo && (
                  <div className="am-fam-form-info" role="status">{formInfo}</div>
                )}
                <button type="submit" className="am-fam-submit-btn">{editingUserId ? '保存修改' : '确认绑定'}</button>
              </form>
            )}

            {/* 待确认邀请提醒(视障端发起,等待家属确认) */}
            {pendingConfirmList.length > 0 && (
              <div className="am-fam-pending-section" role="region" aria-label="待确认绑定邀请">
                <div className="am-fam-pending-banner">
                  <span className="am-fam-pending-icon">🔔</span>
                  <span>您有 {pendingConfirmList.length} 条视障用户绑定邀请待确认</span>
                </div>
                {pendingConfirmList.map(item => {
                  const viName = item.user_nickname || item.user_username || item.user_phone || '视障用户';
                  return (
                    <div key={item.id} className="am-fam-pending-card">
                      <div className="am-fam-pending-info">
                        <div className="am-fam-pending-name">
                          {viName}
                          {item.relation && <span className="am-fam-pending-relation">({item.relation})</span>}
                        </div>
                        {item.user_phone && <div className="am-fam-pending-phone">📱 {item.user_phone}</div>}
                        <div className="am-fam-pending-status pending-me">待我确认</div>
                      </div>
                      <div className="am-fam-pending-actions">
                        <button
                          className="am-fam-confirm-btn"
                          onClick={() => openConfirmModal(item)}
                          aria-label={`确认 ${viName} 的绑定邀请`}
                        >确认</button>
                        <button
                          className="am-fam-reject-btn"
                          onClick={() => handleRejectInvitation(item.id)}
                          aria-label={`拒绝 ${viName} 的绑定邀请`}
                        >拒绝</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {users.length === 0 ? (
              <FamEmpty text="暂未绑定使用者 · 点击右上角添加" />
            ) : (
              <div className="am-fam-user-list">
                {users.map(u => (
                  <div key={u.id} className="am-fam-user-card">
                    <div className="am-fam-user-card-head">
                      <div>
                        <div className="am-fam-user-name">{u.name}</div>
                        <div className="am-fam-user-meta">
                          {u.relation || '未填写关系'}{u.age ? ` · ${u.age}岁` : ''}
                        </div>
                      </div>
                      <div className="am-fam-user-actions">
                        <button
                          className="am-fam-user-edit"
                          onClick={() => handleEditUser(u)}
                          aria-label={`编辑${u.name}`}
                        >编辑</button>
                        <button
                          className="am-fam-user-del"
                          onClick={() => handleDeleteUser(u.id, u.name)}
                          aria-label={`删除${u.name}`}
                        >✕</button>
                      </div>
                    </div>
                    {u.phone && <div className="am-fam-user-phone">📱 {u.phone}</div>}
                    {u.bound_account_id ? (
                      <div className="am-fam-user-bound">
                        <span className="am-fam-bind-badge active">🔗 已绑定视障账号</span>
                        {u.binding_source === 'invitation' && <span className="am-fam-bind-source"> · 通过邀请</span>}
                      </div>
                    ) : (
                      <div className="am-fam-user-bound">
                        <span className="am-fam-bind-badge unbound">○ 未绑定视障账号</span>
                      </div>
                    )}
                    {u.emergency_contact && <div className="am-fam-user-emergency">紧急联系人: {u.emergency_contact} {u.emergency_phone}</div>}
                    {u.health_notes && <div className="am-fam-user-health">⚕ {u.health_notes}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* 紧急联系人 */}
            {contacts.length > 0 && (
              <FamCard title="紧急联系人" icon="📞" color="amber" badge={contacts.length}>
                <div className="am-fam-contact-list">
                  {contacts.map(c => (
                    <div key={c.id} className="am-fam-contact-item">
                      <div>
                        <div className="am-fam-contact-name">
                          {c.name} {c.primary && <span className="am-fam-contact-star">★</span>}
                        </div>
                        <div className="am-fam-contact-relation">{c.relation}</div>
                        <div className="am-fam-contact-phone">{c.phone}</div>
                      </div>
                      <a href={`tel:${c.phone.replace(/\D/g, '')}`} className="am-fam-contact-call">📞 拨打</a>
                    </div>
                  ))}
                </div>
              </FamCard>
            )}

            {/* 退出登录按钮 */}
            <button className="am-fam-logout-btn" onClick={logout}>退出登录</button>
          </>
        )}

        <div className="am-fam-footer">感知方舟家属端 · 守护安全 · 让家属安心</div>
      </div>

      {/* ===== 家属绑定确认对话框(语音+手动双确认) ===== */}
      {showConfirmModal && currentConfirmItem && (
        <div className="am-fam-confirm-overlay" role="dialog" aria-modal="true" aria-label="视障用户绑定确认">
          <div className="am-fam-confirm-modal">
            <h3 className="am-fam-confirm-title">🔔 绑定邀请确认</h3>
            <div className="am-fam-confirm-body">
              <p className="am-fam-confirm-text">
                收到来自 <strong>{currentConfirmItem.user_nickname || currentConfirmItem.user_username || currentConfirmItem.user_phone || '视障用户'}</strong>
                {' '}的家属绑定邀请
              </p>
              {currentConfirmItem.relation && (
                <p className="am-fam-confirm-relation">关系：{currentConfirmItem.relation}</p>
              )}
              {currentConfirmItem.user_phone && (
                <p className="am-fam-confirm-phone">视障用户手机号：{currentConfirmItem.user_phone}</p>
              )}
              <p className="am-fam-confirm-hint">
                {asrSupported && asrListening
                  ? '🎤 正在聆听...请说"确认绑定"或"拒绝"'
                  : '请点击下方按钮确认或拒绝'}
              </p>
              {formError && (
                <p className="am-fam-confirm-error" role="alert">{formError}</p>
              )}
            </div>
            <div className="am-fam-confirm-actions">
              <button
                className="am-fam-confirm-btn-large"
                onClick={() => handleConfirmInvitation(currentConfirmItem.id)}
                disabled={confirmProcessing}
                aria-label="确认绑定"
              >
                {confirmProcessing ? '处理中...' : '✓ 确认绑定'}
              </button>
              <button
                className="am-fam-reject-btn-large"
                onClick={() => handleRejectInvitation(currentConfirmItem.id)}
                disabled={confirmProcessing}
                aria-label="拒绝邀请"
              >
                ✗ 拒绝
              </button>
            </div>
            <button
              className="am-fam-confirm-close"
              onClick={() => { setShowConfirmModal(false); setCurrentConfirmItem(null); setFormError(null); asrStop(); }}
              aria-label="关闭对话框"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 被守护人状态卡片 =====
function GuardianCard({ user }) {
  const activityMap = {
    idle: '待机中', walking: '行走中', navigating: '导航中',
    waiting: '等待中', reading: '阅读中', fallen: '⚠ 已跌倒!'
  };
  const activity = activityMap[user.activity] || '待机中';
  const isFallen = user.activity === 'fallen';
  const battery = user.battery || 87;

  return (
    <div className={`am-fam-guardian-card ${isFallen ? 'fallen' : ''}`}>
      <div className="am-fam-guardian-head">
        <div>
          <div className="am-fam-guardian-label">被守护人</div>
          <div className="am-fam-guardian-name">{user.name || '未绑定'}</div>
        </div>
        <span className={`am-fam-guardian-status ${user.online ? 'online' : 'offline'}`}>
          {user.online ? '● 在线' : '● 离线'}
        </span>
      </div>

      <div className="am-fam-guardian-grid">
        {/* 实时位置 */}
        <div className="am-fam-guardian-loc">
          <div className="am-fam-guardian-loc-label">📍 实时位置</div>
          <div className="am-fam-guardian-loc-addr">{user.location?.address || '等待定位...'}</div>
          {user.location?.lat && (
            <a
              href={`https://uri.amap.com/marker?position=${user.location?.lng},${user.location?.lat}&name=被守护人位置`}
              target="_blank" rel="noopener noreferrer"
              className="am-fam-guardian-map-link"
            >🗺️ 地图查看</a>
          )}
        </div>

        {/* 设备电量 */}
        <div className="am-fam-guardian-batt">
          <div className="am-fam-guardian-batt-label">🔋 设备电量</div>
          <div className="am-fam-guardian-batt-pct">{battery}%</div>
          <div className="am-fam-guardian-batt-bar">
            <div className="am-fam-guardian-batt-fill" style={{ width: `${battery}%` }}></div>
          </div>
          <div className="am-fam-guardian-batt-hint">~{Math.round(battery / 12)}小时</div>
        </div>
      </div>

      {/* 当前活动 */}
      <div className={`am-fam-guardian-activity ${isFallen ? 'fallen' : ''}`}>
        <div className="am-fam-guardian-activity-label">当前活动</div>
        <div className={`am-fam-guardian-activity-text ${isFallen ? 'fallen' : ''}`}>{activity}</div>
        {user.lastSpoken && user.lastSpoken !== '暂无' && (
          <div className="am-fam-guardian-activity-speech">🔊 最近播报: {user.lastSpoken}</div>
        )}
      </div>
    </div>
  );
}

// ===== 统计卡片 =====
function FamStat({ icon, label, value, color }) {
  return (
    <div className={`am-fam-stat ${color}`}>
      <div className="am-fam-stat-icon">{icon}</div>
      <div className="am-fam-stat-value">{value}</div>
      <div className="am-fam-stat-label">{label}</div>
    </div>
  );
}

// ===== 面板卡片组件(毛玻璃,与视障端风格统一) =====
function FamCard({ title, icon, color, badge, children }) {
  return (
    <section className={`am-fam-card ${color || ''}`}>
      <div className="am-fam-card-head">
        <h3 className="am-fam-card-title">{icon} {title}</h3>
        {badge != null && <span className="am-fam-card-badge">{badge}</span>}
      </div>
      <div className="am-fam-card-body">{children}</div>
    </section>
  );
}

// ===== 表单输入框 =====
function FamFormInput({ placeholder, value, onChange, type = 'text', required, disabled }) {
  return (
    <input
      className="am-fam-form-input"
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      autoComplete="nope"
      name={`fam-${placeholder}`}
    />
  );
}

// ===== 空状态 =====
function FamEmpty({ text }) {
  return <div className="am-fam-empty">{text}</div>;
}
