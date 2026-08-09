import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';

// 顶部药丸Tab(与视障端统一框架)
const TABS = [
  { key: 'overview', label: '守护' },
  { key: 'safety', label: '安全' },
  { key: 'routes', label: '路线' },
  { key: 'users', label: '我的' },
];

export default function Family() {
  const { user: currentUser, logout } = useAuth();
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
  const [formData, setFormData] = useState({
    name: '', age: '', relation: '', phone: '',
    emergency_contact: '', emergency_phone: '', health_notes: '',
    bind_phone: ''
  });
  const [liveAlert, setLiveAlert] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [formError, setFormError] = useState(null); // 表单错误提示(如:该账号未注册)

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

  useEffect(() => {
    loadData();
    loadUsers();
    const interval = setInterval(() => {
      loadData(true);
      loadUsers();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData, loadUsers]);

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
    try {
      const payload = {
        ...formData,
        age: formData.age ? parseInt(formData.age) : null
      };
      if (editingUserId) {
        // 编辑模式
        await api.familyUpdateUser(editingUserId, payload);
      } else {
        // 添加模式
        await api.familyAddUser(payload);
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
  }, [formData, editingUserId, loadUsers]);

  // 点击编辑使用者: 预填表单数据并进入编辑模式
  const handleEditUser = useCallback((u) => {
    setEditingUserId(u.id);
    setFormData({
      name: u.name || '',
      age: u.age != null ? String(u.age) : '',
      relation: u.relation || '',
      phone: u.phone || '',
      emergency_contact: u.emergency_contact || '',
      emergency_phone: u.emergency_phone || '',
      health_notes: u.health_notes || '',
      bind_phone: '' // bind_phone 不回填(安全考虑,编辑时重新输入绑定手机号)
    });
    setShowAddForm(true);
  }, []);

  // 取消表单(添加/编辑通用)
  const handleCancelForm = useCallback(() => {
    setShowAddForm(false);
    setEditingUserId(null);
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
                <FamFormInput placeholder="姓名 *" value={formData.name} onChange={v => setFormData({ ...formData, name: v })} required />
                <div className="am-fam-form-row">
                  <FamFormInput placeholder="年龄" type="number" value={formData.age} onChange={v => setFormData({ ...formData, age: v })} />
                  <FamFormInput placeholder="关系(如:父亲)" value={formData.relation} onChange={v => setFormData({ ...formData, relation: v })} />
                </div>
                <FamFormInput placeholder="使用者手机号" value={formData.phone} onChange={v => setFormData({ ...formData, phone: v })} />
                <div className="am-fam-form-row">
                  <FamFormInput placeholder="紧急联系人" value={formData.emergency_contact} onChange={v => setFormData({ ...formData, emergency_contact: v })} />
                  <FamFormInput placeholder="紧急电话" value={formData.emergency_phone} onChange={v => setFormData({ ...formData, emergency_phone: v })} />
                </div>
                <FamFormInput placeholder="健康备注(如:高血压)" value={formData.health_notes} onChange={v => setFormData({ ...formData, health_notes: v })} />
                <FamFormInput placeholder="绑定视障人员手机号(未注册将提示)" value={formData.bind_phone} onChange={v => setFormData({ ...formData, bind_phone: v })} />
                {formError && (
                  <div className="am-fam-form-error" role="alert">{formError}</div>
                )}
                <button type="submit" className="am-fam-submit-btn">{editingUserId ? '保存修改' : '确认绑定'}</button>
              </form>
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
                    {u.bound_account_id && <div className="am-fam-user-bound">🔗 已绑定视障账号 (ID: {u.bound_account_id})</div>}
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
function FamFormInput({ placeholder, value, onChange, type = 'text', required }) {
  return (
    <input
      className="am-fam-form-input"
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
      autoComplete="nope"
      name={`fam-${placeholder}`}
    />
  );
}

// ===== 空状态 =====
function FamEmpty({ text }) {
  return <div className="am-fam-empty">{text}</div>;
}
