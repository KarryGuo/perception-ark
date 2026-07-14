import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

export default function Family() {
  const [overview, setOverview] = useState(null);
  const [sosEvents, setSosEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '', age: '', relation: '', phone: '',
    emergency_contact: '', emergency_phone: '', health_notes: ''
  });
  const [liveAlert, setLiveAlert] = useState(null); // 实时摔倒告警

  const loadOverview = useCallback(async () => {
    try {
      const data = await api.familyOverview();
      setOverview(data);
      setUsers(data.users || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSos = useCallback(async () => {
    try {
      const data = await api.familySos();
      setSosEvents(data.events || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const data = await api.familyContacts();
      setContacts(data.contacts || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadSos();
    loadContacts();
    const interval = setInterval(() => {
      loadOverview();
      loadSos();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadOverview, loadSos, loadContacts]);

  // WebSocket实时监听 - 摔倒告警即时推送
  useWebSocket(useCallback((event) => {
    if (event.type === 'sos') {
      setLiveAlert({ title: event.title, sub: event.sub, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
      loadOverview();
      loadSos();
      // 10秒后自动消失
      setTimeout(() => setLiveAlert(null), 10000);
    }
    if (event.type === 'alert') {
      loadOverview();
    }
  }, [loadOverview, loadSos]));

  // 添加使用者
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
      loadOverview();
    } catch (err) {
      alert('添加失败: ' + err.message);
    }
  }, [formData, loadOverview]);

  // 删除使用者
  const handleDeleteUser = useCallback(async (id, name) => {
    if (!confirm(`确定删除使用者"${name}"？`)) return;
    try {
      await api.familyDeleteUser(id);
      loadOverview();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  }, [loadOverview]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          <div>加载家属端数据...</div>
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
        </div>
      </div>
    );
  }

  const user = overview?.user || {};
  const agents = overview?.agents || {};
  const recentSos = overview?.recentSos || [];
  const stats = overview?.stats || {};

  return (
    <div style={{ minHeight: '100vh', background: 'var(--void)', color: 'var(--ink)', padding: '60px 20px 40px' }}>
      <div className="ambient"></div>
      <nav className="topbar">
        <div className="topbar-left">
          <a href="#/" className="topbar-brand">PerceptionArk</a>
          <span className="topbar-tag">FAMILY APP</span>
          <span className="topbar-trae">家属监护端</span>
        </div>
        <div className="topbar-right">
          <a href="#/" className="tb-link">← 返回眼镜端</a>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{
            fontSize: '1.8rem', fontWeight: 700, marginBottom: 8,
            background: 'linear-gradient(135deg, var(--bio-emerald), var(--bio-cyan))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'
          }}>
            家属监护端 · 实时守护
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '.9rem' }}>
            绑定使用者 · 实时位置 · 跌倒告警 · 设备状态
          </p>
        </div>

        {/* 实时摔倒告警弹窗 */}
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

        {/* 使用者管理 */}
        <div style={{
          background: 'var(--glass)', border: '1px solid var(--gb)',
          borderRadius: 14, padding: 20, marginBottom: 24, backdropFilter: 'blur(20px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--bio-emerald)' }}>👥 使用者管理</h3>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              style={{
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                background: showAddForm ? 'var(--void-3)' : 'rgba(0,255,163,0.1)',
                color: showAddForm ? 'var(--ink-muted)' : 'var(--bio-emerald)',
                border: `1px solid ${showAddForm ? 'var(--gb)' : 'rgba(0,255,163,0.2)'}`,
                fontSize: '.78rem', fontWeight: 600
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
                <input className="fam-input" placeholder="姓名 *" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                <input className="fam-input" type="number" placeholder="年龄" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} />
                <input className="fam-input" placeholder="关系 (如:父亲)" value={formData.relation} onChange={e => setFormData({...formData, relation: e.target.value})} />
                <input className="fam-input" placeholder="使用者手机" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                <input className="fam-input" placeholder="紧急联系人姓名" value={formData.emergency_contact} onChange={e => setFormData({...formData, emergency_contact: e.target.value})} />
                <input className="fam-input" placeholder="紧急联系人电话" value={formData.emergency_phone} onChange={e => setFormData({...formData, emergency_phone: e.target.value})} />
                <input className="fam-input" placeholder="健康备注 (如:高血压)" value={formData.health_notes} onChange={e => setFormData({...formData, health_notes: e.target.value})} style={{ gridColumn: '1 / -1' }} />
              </div>
              <button type="submit" style={{
                marginTop: 12, padding: '8px 20px', borderRadius: 8,
                background: 'linear-gradient(135deg, var(--bio-emerald), var(--bio-cyan))',
                color: 'var(--void)', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '.82rem'
              }}>
                确认绑定
              </button>
            </form>
          )}

          {users.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)', fontSize: '.82rem' }}>
              暂未绑定使用者 · 点击"添加使用者"绑定被守护人信息
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
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
                    <button
                      onClick={() => handleDeleteUser(u.id, u.name)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--ink-faint)', fontSize: '.9rem', padding: '0 4px'
                      }}
                      title="删除"
                    >✕</button>
                  </div>
                  {u.phone && <div style={{ fontSize: '.72rem', color: 'var(--bio-cyan)', fontFamily: 'Space Grotesk, monospace', marginTop: 4 }}>📱 {u.phone}</div>}
                  {u.emergency_contact && <div style={{ fontSize: '.68rem', color: 'var(--ink-soft)', marginTop: 4 }}>
                    紧急联系人: {u.emergency_contact} {u.emergency_phone}
                  </div>}
                  {u.health_notes && <div style={{ fontSize: '.68rem', color: 'var(--bio-amber)', marginTop: 4 }}>
                    ⚕ {u.health_notes}
                  </div>}
                  <div style={{ fontSize: '.6rem', color: 'var(--ink-faint)', marginTop: 6 }}>
                    绑定于 {new Date(u.bound_at).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 被守护人实时状态 */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16, marginBottom: 24
        }}>
          <div style={{
            background: 'var(--glass)', border: '1px solid var(--gb)',
            borderRadius: 14, padding: 20, backdropFilter: 'blur(20px)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--bio-emerald)' }}>被守护人状态</h3>
              <span style={{
                fontSize: '.62rem', padding: '3px 8px', borderRadius: 4,
                background: user.online ? 'rgba(0,255,163,0.1)' : 'rgba(255,46,126,0.1)',
                color: user.online ? 'var(--bio-emerald)' : 'var(--bio-magenta)',
                fontFamily: 'Space Grotesk, monospace'
              }}>
                {user.online ? '● ONLINE' : '● OFFLINE'}
              </span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 4 }}>{user.name || '未绑定'}</div>
            <div style={{ fontSize: '.78rem', color: user.activity === 'fallen' ? 'var(--bio-magenta)' : 'var(--ink-muted)' }}>
              当前活动: <strong>{activityText(user.activity)}</strong>
            </div>
            {user.lastSpoken && user.lastSpoken !== '暂无' && (
              <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--ink-soft)', padding: 8, borderRadius: 6, background: 'rgba(0,255,163,0.04)' }}>
                🔊 最近播报: {user.lastSpoken}
              </div>
            )}
          </div>

          <div style={{
            background: 'var(--glass)', border: '1px solid var(--gb)',
            borderRadius: 14, padding: 20, backdropFilter: 'blur(20px)'
          }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--bio-amber)', marginBottom: 12 }}>📍 实时位置</h3>
            <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
              {user.location?.address || '等待定位...'}
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
              {user.location?.lat?.toFixed(4)}, {user.location?.lng?.toFixed(4)}
            </div>
            {user.location?.lat && (
              <a
                href={`https://uri.amap.com/marker?position=${user.location?.lng},${user.location?.lat}&name=被守护人位置`}
                target="_blank"
                rel="noopener noreferrer"
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
          </div>

          <div style={{
            background: 'var(--glass)', border: '1px solid var(--gb)',
            borderRadius: 14, padding: 20, backdropFilter: 'blur(20px)'
          }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--bio-violet)', marginBottom: 12 }}>🔋 设备状态</h3>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--bio-emerald)' }}>
              {user.battery || 87}%
            </div>
            <div style={{
              height: 6, background: 'var(--void-3)', borderRadius: 3,
              marginTop: 8, overflow: 'hidden'
            }}>
              <div style={{
                width: `${user.battery || 87}%`, height: '100%',
                background: 'linear-gradient(90deg, var(--bio-emerald), var(--bio-cyan))'
              }}></div>
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 6 }}>
              续航预估: ~{Math.round((user.battery || 87) / 12)}小时
            </div>
          </div>
        </div>

        {/* 五Agent状态 */}
        <div style={{
          background: 'var(--glass)', border: '1px solid var(--gb)',
          borderRadius: 14, padding: 20, marginBottom: 24, backdropFilter: 'blur(20px)'
        }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--bio-cyan)', marginBottom: 14 }}>
            🤖 五智能体状态 (TRAE Agent Orchestration)
          </h3>
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
                <div style={{
                  fontSize: '.62rem', marginTop: 4,
                  color: info.active ? 'var(--bio-emerald)' : 'var(--ink-muted)'
                }}>
                  {info.active ? '● ACTIVE' : '○ IDLE'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SOS告警历史 */}
        <div style={{
          background: 'var(--glass)', border: '1px solid var(--gb)',
          borderRadius: 14, padding: 20, marginBottom: 24, backdropFilter: 'blur(20px)'
        }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--bio-magenta)', marginBottom: 14 }}>
            🚨 SOS告警历史 ({sosEvents.length})
          </h3>
          {sosEvents.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)', fontSize: '.82rem' }}>
              ✓ 暂无SOS事件 · 一切正常
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sosEvents.slice(0, 10).map(evt => (
                <div key={evt.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 12, borderRadius: 8, background: 'var(--void-3)',
                  border: '1px solid rgba(255,46,126,0.15)'
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
        </div>

        {/* 紧急联系人 */}
        <div style={{
          background: 'var(--glass)', border: '1px solid var(--gb)',
          borderRadius: 14, padding: 20, marginBottom: 24, backdropFilter: 'blur(20px)'
        }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--bio-amber)', marginBottom: 14 }}>
            👥 紧急联系人
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
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
                <a
                  href={`tel:${c.phone.replace(/\D/g, '')}`}
                  style={{
                    padding: '6px 10px', borderRadius: 6, textDecoration: 'none',
                    background: 'rgba(0,255,163,0.08)', color: 'var(--bio-emerald)',
                    border: '1px solid rgba(0,255,163,0.2)', fontSize: '.72rem'
                  }}
                >
                  📞 拨打
                </a>
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-faint)', fontSize: '.72rem' }}>
          PerceptionArk Family App · TRAE AI Creativity Competition 2026<br/>
          让黑暗有光 · 让家属安心
        </div>
      </div>
    </div>
  );
}

function activityText(activity) {
  const map = {
    idle: '待机中',
    walking: '行走中',
    navigating: '导航中',
    waiting: '等待中',
    reading: '阅读中',
    fallen: '⚠ 已跌倒!'
  };
  return map[activity] || activity || '待机中';
}
