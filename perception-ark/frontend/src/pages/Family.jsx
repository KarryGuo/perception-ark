import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

const TABS = [
  { key: 'overview', label: '总览', icon: '📊' },
  { key: 'recognition', label: '识别记录', icon: '👁️' },
  { key: 'safety', label: '安全事件', icon: '🛡️' },
  { key: 'routes', label: '路线', icon: '🗺️' },
  { key: 'users', label: '使用者', icon: '👥' },
  { key: 'contacts', label: '联系人', icon: '📞' },
];

export default function Family() {
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
  const [formData, setFormData] = useState({
    name: '', age: '', relation: '', phone: '',
    emergency_contact: '', emergency_phone: '', health_notes: ''
  });
  const [liveAlert, setLiveAlert] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [dash, sos, contactList, routeData, recog] = await Promise.all([
        api.familyDashboard().catch(() => null),
        api.familySos().catch(() => ({ events: [] })),
        api.familyContacts().catch(() => ({ contacts: [] })),
        api.familyRoutes().catch(() => ({ routes: [] })),
        api.familyRecognitionHistory(50).catch(() => ({ events: [] })),
      ]);
      if (dash) {
        setDashboard(dash);
        setUsers(dash.stats?.totalUsers != null ? [] : (dash.user ? [dash.user] : []));
      }
      setSosEvents(sos?.events || []);
      setContacts(contactList?.contacts || []);
      setRoutes(routeData?.routes || []);
      setRecognitionHistory(recog?.events || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
      loadData();
      loadUsers();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData, loadUsers]);

  useWebSocket(useCallback((event) => {
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
    try {
      await api.familyAddUser({
        ...formData,
        age: formData.age ? parseInt(formData.age) : null
      });
      setFormData({ name: '', age: '', relation: '', phone: '', emergency_contact: '', emergency_phone: '', health_notes: '' });
      setShowAddForm(false);
      loadUsers();
    } catch (err) {
      alert('添加失败: ' + err.message);
    }
  }, [formData, loadUsers]);

  const handleDeleteUser = useCallback(async (id, name) => {
    if (!confirm(`确定删除使用者"${name}"？`)) return;
    try {
      await api.familyDeleteUser(id);
      loadUsers();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  }, [loadUsers]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: '1rem' }}>加载管理端数据...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bio-magenta)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>❌</div>
          <div>加载失败: {error}</div>
          <div style={{ marginTop: 12, fontSize: '.8rem', color: 'var(--ink-muted)' }}>请确保后端服务已启动 (端口3001)</div>
          <button onClick={loadData} style={{ marginTop: 16, padding: '8px 24px', borderRadius: 8, border: '1px solid var(--gb)', background: 'var(--glass)', color: 'var(--ink)', cursor: 'pointer', fontSize: '.82rem' }}>重试</button>
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
    <div style={{ minHeight: '100vh', background: 'var(--void)', color: 'var(--ink)', paddingBottom: 40 }}>
      <div className="ambient"></div>
      <nav className="topbar" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="topbar-left">
          <a href="#/" className="topbar-brand">PerceptionArk</a>
          <span className="topbar-tag">ADMIN PANEL</span>
          <span className="topbar-trae">管理端</span>
        </div>
        <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '.72rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace', padding: '3px 8px', borderRadius: 4, background: 'var(--void-3)', border: '1px solid var(--gb)' }}>
            {new Date(dashboard?.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
          <a href="#/app" className="tb-link">← 移动端</a>
        </div>
      </nav>
      {liveAlert && (
        <div style={{
          position: 'fixed', top: 70, right: 20, zIndex: 999,
          background: 'rgba(255,46,126,0.15)', border: '2px solid var(--bio-magenta)',
          borderRadius: 14, padding: '20px 24px', backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(255,46,126,0.3)', animation: 'pulse 1.5s ease-in-out infinite',
          maxWidth: 360
        }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--bio-magenta)', marginBottom: 6 }}>
            🚨 {liveAlert.title}
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>{liveAlert.sub}</div>
          <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 8 }}>{liveAlert.time}</div>
        </div>
      )}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 24, paddingTop: 10 }}>
          <h1 style={{
            fontSize: '1.8rem', fontWeight: 700, marginBottom: 6,
            background: 'linear-gradient(135deg, var(--bio-emerald), var(--bio-cyan))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'
          }}>
            感知方舟 · 管理端
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '.85rem' }}>
            实时监控 · 识别记录 · 安全事件 · 路线管理 · 使用者管理
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard icon="👁️" label="环境识别" value={stats.totalRecognitions || 0} color="var(--bio-emerald)" />
          <StatCard icon="🛡️" label="安全扫描" value={stats.totalSafetyChecks || 0} color="var(--bio-cyan)" />
          <StatCard icon="⚠️" label="危险预警" value={stats.dangerCount || 0} color="var(--bio-magenta)" />
          <StatCard icon="🚨" label="今日SOS" value={stats.todaySos || 0} color="var(--bio-amber)" />
          <StatCard icon="🗺️" label="路线记录" value={stats.totalRoutes || 0} color="var(--bio-violet)" />
          <StatCard icon="🧠" label="习惯记忆" value={stats.totalHabits || 0} color="var(--bio-cyan)" />
        </div>
        <div style={{
          display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto',
          background: 'var(--glass)', border: '1px solid var(--gb)', borderRadius: 12,
          padding: 4, backdropFilter: 'blur(20px)', flexWrap: 'wrap'
        }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: activeTab === tab.key ? 'rgba(0,255,163,0.12)' : 'transparent',
                color: activeTab === tab.key ? 'var(--bio-emerald)' : 'var(--ink-muted)',
                fontSize: '.82rem', fontWeight: activeTab === tab.key ? 600 : 400,
                whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'inherit'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: 24 }}>
          {activeTab === 'overview' && (
            <OverviewTab user={user} agents={agents} recentRecognitions={recentRecognitions} recentSos={recentSos} />
          )}
          {activeTab === 'recognition' && (
            <RecognitionTab events={recognitionHistory} />
          )}
          {activeTab === 'safety' && (
            <SafetyTab safety={recentSafety} sos={sosEvents} />
          )}
          {activeTab === 'routes' && (
            <RoutesTab routes={routes} topRoutes={topRoutes} />
          )}
          {activeTab === 'users' && (
            <UsersTab users={users} showAddForm={showAddForm} setShowAddForm={setShowAddForm}
              formData={formData} setFormData={setFormData} handleAddUser={handleAddUser} handleDeleteUser={handleDeleteUser} />
          )}
          {activeTab === 'contacts' && (
            <ContactsTab contacts={contacts} />
          )}
        </div>
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-faint)', fontSize: '.72rem' }}>
          PerceptionArk Admin Panel · TRAE AI Creativity Competition 2026<br />
          让黑暗有光 · 让家属安心
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{
      background: 'var(--glass)', border: '1px solid var(--gb)',
      borderRadius: 12, padding: '14px 16px', backdropFilter: 'blur(20px)',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color, fontFamily: 'Space Grotesk, monospace' }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--ink-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Panel({ title, color, children, badge }) {
  return (
    <div style={{
      background: 'var(--glass)', border: '1px solid var(--gb)',
      borderRadius: 14, padding: 20, backdropFilter: 'blur(20px)', marginBottom: 16
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: '1rem', color, margin: 0 }}>{title}</h3>
        {badge != null && (
          <span style={{ fontSize: '.65rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(0,255,163,0.08)', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function OverviewTab({ user, agents, recentRecognitions, recentSos }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="被守护人状态" color="var(--bio-emerald)">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{
              fontSize: '.62rem', padding: '3px 8px', borderRadius: 4,
              background: user.online ? 'rgba(0,255,163,0.1)' : 'rgba(255,46,126,0.1)',
              color: user.online ? 'var(--bio-emerald)' : 'var(--bio-magenta)',
              fontFamily: 'Space Grotesk, monospace'
            }}>
              {user.online ? '● ONLINE' : '● OFFLINE'}
            </span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: 4 }}>{user.name || '未绑定'}</div>
          <div style={{ fontSize: '.78rem', color: user.activity === 'fallen' ? 'var(--bio-magenta)' : 'var(--ink-muted)' }}>
            当前活动: <strong>{activityText(user.activity)}</strong>
          </div>
          {user.lastSpoken && user.lastSpoken !== '暂无' && (
            <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--ink-soft)', padding: 8, borderRadius: 6, background: 'rgba(0,255,163,0.04)' }}>
              🔊 最近播报: {user.lastSpoken}
            </div>
          )}
        </Panel>

        <Panel title="📍 实时位置" color="var(--bio-amber)">
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            {user.location?.address || '等待定位...'}
          </div>
          <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
            {user.location?.lat?.toFixed(4)}, {user.location?.lng?.toFixed(4)}
          </div>
          {user.location?.lat && (
            <a
              href={`https://uri.amap.com/marker?position=${user.location?.lng},${user.location?.lat}&name=被守护人位置`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-block', marginTop: 10, fontSize: '.72rem',
                color: 'var(--bio-emerald)', textDecoration: 'none',
                padding: '4px 10px', border: '1px solid rgba(0,255,163,0.2)',
                borderRadius: 6, background: 'rgba(0,255,163,0.05)'
              }}
            >
              🗺️ 在高德地图查看 →
            </a>
          )}
        </Panel>

        <Panel title="🔋 设备状态" color="var(--bio-violet)">
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--bio-emerald)' }}>
            {user.battery || 87}%
          </div>
          <div style={{ height: 6, background: 'var(--void-3)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
            <div style={{
              width: `${user.battery || 87}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--bio-emerald), var(--bio-cyan))'
            }}></div>
          </div>
          <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 6 }}>
            续航预估: ~{Math.round((user.battery || 87) / 12)}小时
          </div>
        </Panel>
      </div>

      <Panel title="🤖 五智能体状态" color="var(--bio-cyan)" badge={Object.values(agents).filter(a => a.active).length + '/5 活跃'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {Object.entries(agents).map(([id, info]) => (
            <div key={id} style={{
              padding: 12, borderRadius: 10,
              background: info.active ? 'rgba(0,255,163,0.05)' : 'var(--void-3)',
              border: `1px solid ${info.active ? 'rgba(0,255,163,0.2)' : 'var(--gb)'}`,
            }}>
              <div style={{ fontSize: '.7rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
                {id} · P{info.priority}
              </div>
              <div style={{ fontSize: '.85rem', fontWeight: 600, marginTop: 2 }}>{info.name}</div>
              <div style={{ fontSize: '.62rem', marginTop: 4, color: info.active ? 'var(--bio-emerald)' : 'var(--ink-muted)' }}>
                {info.active ? '● ACTIVE' : '○ IDLE'}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
        <Panel title="👁️ 最近识别" color="var(--bio-emerald)" badge={recentRecognitions.length}>
          {recentRecognitions.length === 0 ? (
            <EmptyState text="暂无识别记录" />
          ) : (
            <EventList events={recentRecognitions.slice(0, 5)} type="recognition" />
          )}
        </Panel>
        <Panel title="🚨 最近SOS" color="var(--bio-magenta)" badge={recentSos.length}>
          {recentSos.length === 0 ? (
            <EmptyState text="✓ 暂无SOS事件" />
          ) : (
            <EventList events={recentSos.slice(0, 5)} type="sos" />
          )}
        </Panel>
      </div>
    </div>
  );
}

function RecognitionTab({ events }) {
  return (
    <Panel title="👁️ 环境识别记录" color="var(--bio-emerald)" badge={events.length}>
      {events.length === 0 ? (
        <EmptyState text="暂无识别记录，启动移动端后将实时显示" />
      ) : (
        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          <EventList events={events} type="recognition" />
        </div>
      )}
    </Panel>
  );
}

function SafetyTab({ safety, sos }) {
  return (
    <div>
      <Panel title="🛡️ 安全预警记录" color="var(--bio-magenta)" badge={safety.length}>
        {safety.length === 0 ? (
          <EmptyState text="暂无安全预警，一切正常" />
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {safety.map((evt, i) => (
              <div key={i} style={{
                padding: 10, borderRadius: 8, marginBottom: 6,
                background: 'rgba(255,46,126,0.06)', border: '1px solid rgba(255,46,126,0.15)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '.82rem', color: 'var(--bio-magenta)', fontWeight: 600 }}>
                    ⚠️ {evt.object || '障碍物'} · {evt.direction || '正前方'} · {evt.distance != null ? `${evt.distance}米` : '附近'}
                  </div>
                  <span style={{ fontSize: '.62rem', color: 'var(--ink-muted)' }}>
                    {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : ''}
                  </span>
                </div>
                {evt.action && <div style={{ fontSize: '.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>建议: {evt.action}</div>}
                {evt.traffic_light && <div style={{ fontSize: '.72rem', color: evt.traffic_light === 'red' ? 'var(--bio-magenta)' : 'var(--bio-amber)', marginTop: 2 }}>
                  🚦 红绿灯: {evt.traffic_light === 'red' ? '红灯' : evt.traffic_light === 'green' ? '绿灯' : '黄灯'}
                </div>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="🚨 SOS告警历史" color="var(--bio-amber)" badge={sos.length}>
        {sos.length === 0 ? (
          <EmptyState text="✓ 暂无SOS事件" />
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {sos.map(evt => (
              <div key={evt.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 12, borderRadius: 8, marginBottom: 6,
                background: 'var(--void-3)', border: '1px solid rgba(255,46,126,0.15)'
              }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--ink)' }}>
                    {evt.event_type === 'fall' ? '⚠ 跌倒检测' : `🚨 ${evt.event_type}`}
                  </div>
                  <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                    {evt.address} · 联系人: {evt.contact_name || '未设置'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: '.62rem', padding: '2px 8px', borderRadius: 4,
                    background: evt.status === 'pending' ? 'rgba(255,182,39,0.1)' : 'rgba(0,255,163,0.1)',
                    color: evt.status === 'pending' ? 'var(--bio-amber)' : 'var(--bio-emerald)'
                  }}>
                    {evt.status === 'pending' ? '处理中' : '已通知'}
                  </div>
                  <div style={{ fontSize: '.62rem', color: 'var(--ink-faint)', marginTop: 4 }}>
                    {new Date(evt.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RoutesTab({ routes, topRoutes }) {
  return (
    <div>
      <Panel title="🗺️ 常用路线 (Top 5)" color="var(--bio-violet)" badge={topRoutes.length}>
        {topRoutes.length === 0 ? (
          <EmptyState text="暂无常用路线，使用导航后将自动记录" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
            {topRoutes.map(r => (
              <div key={r.id} style={{
                padding: 14, borderRadius: 10, background: 'var(--void-3)',
                border: '1px solid rgba(124,97,255,0.2)'
              }}>
                <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--bio-violet)' }}>{r.route_name || '未命名路线'}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 4 }}>
                  访问 {r.visit_count} 次 · 最近: {new Date(r.last_visited).toLocaleDateString('zh-CN')}
                </div>
                <div style={{ fontSize: '.62rem', color: 'var(--ink-faint)', fontFamily: 'Space Grotesk, monospace', marginTop: 2 }}>
                  ({r.start_lat?.toFixed(4)}, {r.start_lng?.toFixed(4)}) → ({r.end_lat?.toFixed(4)}, {r.end_lng?.toFixed(4)})
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="📋 全部路线记录" color="var(--ink-muted)" badge={routes.length}>
        {routes.length === 0 ? (
          <EmptyState text="暂无路线记录" />
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--gb)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', color: 'var(--ink-muted)', fontWeight: 500 }}>路线名称</th>
                  <th style={{ padding: '8px 12px', color: 'var(--ink-muted)', fontWeight: 500 }}>访问次数</th>
                  <th style={{ padding: '8px 12px', color: 'var(--ink-muted)', fontWeight: 500 }}>最近访问</th>
                  <th style={{ padding: '8px 12px', color: 'var(--ink-muted)', fontWeight: 500 }}>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--gb)' }}>
                    <td style={{ padding: '8px 12px' }}>{r.route_name || '未命名'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'Space Grotesk, monospace' }}>{r.visit_count}</td>
                    <td style={{ padding: '8px 12px' }}>{new Date(r.last_visited).toLocaleString('zh-CN')}</td>
                    <td style={{ padding: '8px 12px' }}>{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function UsersTab({ users, showAddForm, setShowAddForm, formData, setFormData, handleAddUser, handleDeleteUser }) {
  return (
    <Panel title="👥 使用者管理" color="var(--bio-emerald)" badge={users.length}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
            background: showAddForm ? 'var(--void-3)' : 'rgba(0,255,163,0.1)',
            color: showAddForm ? 'var(--ink-muted)' : 'var(--bio-emerald)',
            border: `1px solid ${showAddForm ? 'var(--gb)' : 'rgba(0,255,163,0.2)'}`,
            fontSize: '.78rem', fontWeight: 600, fontFamily: 'inherit'
          }}
        >
          {showAddForm ? '取消' : '+ 添加使用者'}
        </button>
      </div>
      {showAddForm && (
        <form onSubmit={handleAddUser} style={{
          marginBottom: 16, padding: 16, borderRadius: 10,
          background: 'var(--void-3)', border: '1px solid var(--gb)'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <input className="fam-input" placeholder="姓名 *" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
            <input className="fam-input" type="number" placeholder="年龄" value={formData.age} onChange={e => setFormData({ ...formData, age: e.target.value })} />
            <input className="fam-input" placeholder="关系 (如:父亲)" value={formData.relation} onChange={e => setFormData({ ...formData, relation: e.target.value })} />
            <input className="fam-input" placeholder="使用者手机" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
            <input className="fam-input" placeholder="紧急联系人姓名" value={formData.emergency_contact} onChange={e => setFormData({ ...formData, emergency_contact: e.target.value })} />
            <input className="fam-input" placeholder="紧急联系人电话" value={formData.emergency_phone} onChange={e => setFormData({ ...formData, emergency_phone: e.target.value })} />
            <input className="fam-input" placeholder="健康备注 (如:高血压)" value={formData.health_notes} onChange={e => setFormData({ ...formData, health_notes: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          </div>
          <button type="submit" style={{
            marginTop: 12, padding: '8px 20px', borderRadius: 8,
            background: 'linear-gradient(135deg, var(--bio-emerald), var(--bio-cyan))',
            color: 'var(--void)', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '.82rem', fontFamily: 'inherit'
          }}>
            确认绑定
          </button>
        </form>
      )}
      {users.length === 0 ? (
        <EmptyState text="暂未绑定使用者 · 点击上方按钮添加" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          {users.map(u => (
            <div key={u.id} style={{
              padding: 14, borderRadius: 10, background: 'var(--void-3)',
              border: '1px solid rgba(0,255,163,0.15)', position: 'relative'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <div style={{ fontSize: '.95rem', fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                    {u.relation || '未填写关系'}{u.age ? ` · ${u.age}岁` : ''}
                  </div>
                </div>
                <button onClick={() => handleDeleteUser(u.id, u.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: '.9rem', padding: '0 4px' }}
                  title="删除">✕</button>
              </div>
              {u.phone && <div style={{ fontSize: '.72rem', color: 'var(--bio-cyan)', fontFamily: 'Space Grotesk, monospace', marginTop: 4 }}>📱 {u.phone}</div>}
              {u.emergency_contact && <div style={{ fontSize: '.68rem', color: 'var(--ink-soft)', marginTop: 4 }}>
                紧急联系人: {u.emergency_contact} {u.emergency_phone}
              </div>}
              {u.health_notes && <div style={{ fontSize: '.68rem', color: 'var(--bio-amber)', marginTop: 4 }}>⚕ {u.health_notes}</div>}
              <div style={{ fontSize: '.6rem', color: 'var(--ink-faint)', marginTop: 6 }}>
                绑定于 {new Date(u.bound_at).toLocaleString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ContactsTab({ contacts }) {
  return (
    <Panel title="📞 紧急联系人" color="var(--bio-amber)" badge={contacts.length}>
      {contacts.length === 0 ? (
        <EmptyState text="暂无紧急联系人 · 请在「使用者管理」中绑定使用者并填写紧急联系人信息" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
          {contacts.map(c => (
            <div key={c.id} style={{
              padding: 14, borderRadius: 10, background: 'var(--void-3)',
              border: `1px solid ${c.primary ? 'rgba(255,182,39,0.2)' : 'var(--gb)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ fontSize: '.85rem', fontWeight: 600 }}>
                  {c.name} {c.primary && <span style={{ fontSize: '.6rem', color: 'var(--bio-amber)' }}>★ 主要</span>}
                </div>
                <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)' }}>{c.relation}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--bio-cyan)', fontFamily: 'Space Grotesk, monospace', marginTop: 2 }}>
                  {c.phone}
                </div>
              </div>
              <a href={`tel:${c.phone.replace(/\D/g, '')}`}
                style={{
                  padding: '6px 10px', borderRadius: 6, textDecoration: 'none',
                  background: 'rgba(0,255,163,0.08)', color: 'var(--bio-emerald)',
                  border: '1px solid rgba(0,255,163,0.2)', fontSize: '.72rem'
                }}>📞 拨打</a>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EventList({ events, type }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map((evt, i) => {
        const time = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '';
        if (type === 'recognition') {
          const text = evt.text || evt.message || '';
          return (
            <div key={i} style={{ fontSize: '.78rem', padding: '8px 10px', borderRadius: 6, background: 'rgba(0,255,163,0.04)', border: '1px solid rgba(0,255,163,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ flex: 1 }}>{text}</span>
              <span style={{ fontSize: '.62rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{time}</span>
            </div>
          );
        }
        if (type === 'sos') {
          return (
            <div key={evt.id} style={{ fontSize: '.78rem', padding: '8px 10px', borderRadius: 6, background: 'rgba(255,46,126,0.06)', border: '1px solid rgba(255,46,126,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{evt.event_type === 'fall' ? '⚠ 跌倒检测' : `🚨 ${evt.event_type}`} · {evt.address || '未知位置'}</span>
              <span style={{ fontSize: '.62rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{new Date(evt.created_at).toLocaleString('zh-CN')}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: '.82rem' }}>
      {text}
    </div>
  );
}

function activityText(activity) {
  const map = {
    idle: '待机中', walking: '行走中', navigating: '导航中',
    waiting: '等待中', reading: '阅读中', fallen: '⚠ 已跌倒!'
  };
  return map[activity] || activity || '待机中';
}
