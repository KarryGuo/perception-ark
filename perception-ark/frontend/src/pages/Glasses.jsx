import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';
import { LineChart, DonutChart, BarChart } from '../components/Charts.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const TABS = [
  { key: 'devices', label: '设备监测', icon: '📡' },
  { key: 'accounts', label: '账号管理', icon: '👥' },
  { key: 'logs', label: '操作日志', icon: '📋' },
];

export default function Glasses() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('devices');
  const [devices, setDevices] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banModal, setBanModal] = useState(null); // { account, action: 'ban'|'unban' }
  const [banReason, setBanReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [dev, acc, logData, ana] = await Promise.all([
        api.adminDevices().catch(() => null),
        api.adminAccounts().catch(() => ({ accounts: [] })),
        api.adminLogs(50).catch(() => ({ logs: [] })),
        api.adminAnalytics().catch(() => null),
      ]);
      if (dev) setDevices(dev);
      setAccounts(acc?.accounts || []);
      setLogs(logData?.logs || []);
      if (ana) setAnalytics(ana);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleBan = useCallback(async () => {
    if (!banModal) return;
    try {
      if (banModal.action === 'ban') {
        await api.adminBanAccount(banModal.account.id, banReason || '违规操作');
      } else {
        await api.adminUnbanAccount(banModal.account.id, banReason || '申诉通过');
      }
      setBanModal(null);
      setBanReason('');
      loadData();
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
  }, [banModal, banReason, loadData]);

  // 非管理员不能访问管理后台
  if (user && user.role !== 'admin') {
    if (typeof window !== 'undefined') window.location.hash = '#/app';
    return null;
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: '1rem' }}>加载管理后台数据...</div>
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
          <div style={{ marginTop: 12, fontSize: '.8rem', color: 'var(--ink-muted)' }}>需要管理员权限访问此页面</div>
          <button onClick={loadData} style={{ marginTop: 16, padding: '8px 24px', borderRadius: 8, border: '1px solid var(--gb)', background: 'var(--glass)', color: 'var(--ink)', cursor: 'pointer', fontSize: '.82rem' }}>重试</button>
        </div>
      </div>
    );
  }

  const accStats = devices?.accounts || {};
  const devInfo = devices?.devices || {};
  const sysInfo = devices?.system || {};
  const dashStats = devices?.dashboard || {};  // 运营数据看板

  return (
    <div style={{ minHeight: '100vh', background: 'var(--void)', color: 'var(--ink)', paddingBottom: 40 }}>
      <div className="ambient"></div>
      <nav className="topbar" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="topbar-left">
          <a href="#/" className="topbar-brand">PerceptionArk</a>
          <span className="topbar-tag">ADMIN</span>
          <span className="topbar-trae">管理后台</span>
        </div>
        <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '.72rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace', padding: '3px 8px', borderRadius: 4, background: 'var(--void-3)', border: '1px solid var(--gb)' }}>
            {new Date(devices?.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
          {user && <span style={{ fontSize: '.72rem', color: 'var(--bio-emerald)' }}>管理员 · {user.username}</span>}
          <ThemeToggle size="sm" />
          <button onClick={logout} style={{ background: 'none', border: '1px solid var(--gb)', color: 'var(--ink-muted)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontFamily: 'inherit' }}>退出</button>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 24, paddingTop: 10 }}>
          <h1 style={{
            fontSize: '1.8rem', fontWeight: 700, marginBottom: 6,
            background: 'linear-gradient(135deg, var(--bio-magenta), var(--bio-violet))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'
          }}>
            感知方舟 · 管理后台
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '.85rem' }}>
            设备监测 · 违规账号处理 · 系统运行状况
          </p>
        </div>

        {/* 统计卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard icon="👥" label="总账号数" value={accStats.total || 0} color="var(--bio-emerald)" />
          <StatCard icon="🦯" label="视障用户" value={accStats.users || 0} color="var(--bio-cyan)" />
          <StatCard icon="👨‍👩‍👧" label="家属" value={accStats.families || 0} color="var(--bio-violet)" />
          <StatCard icon="🚫" label="已封禁" value={accStats.banned || 0} color="var(--bio-magenta)" />
          <StatCard icon="🔋" label="设备电量" value={`${devInfo.battery || 0}%`} color="var(--bio-amber)" />
          <StatCard icon="📡" label="设备状态" value={devInfo.online ? '在线' : '离线'} color={devInfo.online ? 'var(--bio-emerald)' : 'var(--bio-magenta)'} />
        </div>

        {/* 运营数据看板 */}
        <div style={{
          background: 'var(--glass)', border: '1px solid var(--gb)', borderRadius: 16,
          padding: 20, marginBottom: 20, backdropFilter: 'blur(20px)',
        }}>
          <h3 style={{
            fontSize: '1rem', fontWeight: 600, margin: '0 0 16px',
            color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8
          }}>
            <span style={{
              display: 'inline-block', width: 4, height: 16, borderRadius: 2,
              background: 'linear-gradient(180deg, var(--bio-magenta), var(--bio-violet))'
            }}></span>
            📊 运营数据看板
            <span style={{ marginLeft: 'auto', fontSize: '.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
              更新于 {new Date(devices?.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <DashCard icon="🟢" label="今日活跃" value={dashStats.activeToday || 0} sub="用户" color="var(--bio-emerald)" />
            <DashCard icon="📱" label="在线设备" value={dashStats.onlineDevices || 0} sub="台" color="var(--bio-cyan)" />
            <DashCard icon="🚨" label="今日SOS" value={dashStats.todaySos || 0} sub="次" color="var(--bio-magenta)" />
            <DashCard icon="🤖" label="智能体" value={`${dashStats.activeAgents || 0}/${dashStats.totalAgents || 0}`} sub="运行" color="var(--bio-violet)" />
            <DashCard icon="👁️" label="累计识别" value={dashStats.totalRecognitions || 0} sub="次" color="var(--bio-emerald)" />
            <DashCard icon="🛡️" label="安全检查" value={dashStats.totalSafetyChecks || 0} sub="次" color="var(--bio-cyan)" />
            <DashCard icon="⚠️" label="危险预警" value={dashStats.totalDangerCount || 0} sub="次" color="var(--bio-amber)" />
            <DashCard icon="⏱️" label="运行时长" value={formatUptime(dashStats.uptime)} sub="" color="var(--bio-violet)" />
          </div>
        </div>

        {/* 数据分析图表 */}
        <AnalyticsSection analytics={analytics} />

        {/* Tab切换 */}
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
                background: activeTab === tab.key ? 'rgba(255,46,126,0.12)' : 'transparent',
                color: activeTab === tab.key ? 'var(--bio-magenta)' : 'var(--ink-muted)',
                fontSize: '.82rem', fontWeight: activeTab === tab.key ? 600 : 400,
                whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'inherit'
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab内容 */}
        {activeTab === 'devices' && (
          <DevicesTab devices={devices} sysInfo={sysInfo} devInfo={devInfo} />
        )}
        {activeTab === 'accounts' && (
          <AccountsTab accounts={accounts} currentUserId={user?.id} setBanModal={setBanModal} />
        )}
        {activeTab === 'logs' && (
          <LogsTab logs={logs} />
        )}

        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-faint)', fontSize: '.72rem' }}>
          PerceptionArk Admin Console · TRAE AI Creativity Competition 2026<br />
          守护安全 · 规范运营
        </div>
      </div>

      {/* 封禁/解封弹窗 */}
      {banModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)'
        }} onClick={() => setBanModal(null)}>
          <div style={{
            background: 'var(--glass)', border: '1px solid var(--gb)', borderRadius: 16,
            padding: 28, maxWidth: 420, width: '90%', backdropFilter: 'blur(20px)'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', margin: '0 0 8px', color: banModal.action === 'ban' ? 'var(--bio-magenta)' : 'var(--bio-emerald)' }}>
              {banModal.action === 'ban' ? '🚫 封禁账号' : '✅ 解封账号'}
            </h3>
            <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 16 }}>
              目标账号: <strong>{banModal.account.username}</strong>
              ({banModal.account.role === 'user' ? '视障用户' : banModal.account.role === 'family' ? '家属' : '管理员'})
              {banModal.account.phone && ` · ${banModal.account.phone}`}
            </p>
            <input
              placeholder={banModal.action === 'ban' ? '封禁原因 (如:发布违规内容)' : '解封原因 (如:申诉通过)'}
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              style={{ width: '100%', marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: 'var(--void-3)', border: '1px solid var(--gb)', color: 'var(--ink)', fontSize: '.88rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              autoComplete="nope"
              name="banReason"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setBanModal(null)} style={{
                padding: '8px 20px', borderRadius: 8, border: '1px solid var(--gb)',
                background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', fontSize: '.82rem', fontFamily: 'inherit'
              }}>取消</button>
              <button onClick={handleBan} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: banModal.action === 'ban' ? 'var(--bio-magenta)' : 'var(--bio-emerald)',
                color: '#fff', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, fontFamily: 'inherit'
              }}>{banModal.action === 'ban' ? '确认封禁' : '确认解封'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{
      background: 'var(--glass)', border: '1px solid var(--gb)',
      borderRadius: 12, padding: '14px 16px', backdropFilter: 'blur(20px)', textAlign: 'center'
    }}>
      <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color, fontFamily: 'Space Grotesk, monospace' }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--ink-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// 运营看板数据卡片(带副标题+彩色左边框)
function DashCard({ icon, label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--void-3)', border: '1px solid var(--gb)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '1rem' }}>{icon}</span>
        <span style={{ fontSize: '.72rem', color: 'var(--ink-muted)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: '1.2rem', fontWeight: 700, color, fontFamily: 'Space Grotesk, monospace' }}>{value}</span>
        {sub && <span style={{ fontSize: '.68rem', color: 'var(--ink-faint)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// 运行时长格式化(秒→天/时/分)
function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '0分';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

// SOS事件类型 → 中文名 + 颜色 映射
const SOS_TYPE_META = {
  fall: { name: '跌倒检测', color: '#FF2E7E' },
  manual: { name: '主动SOS', color: '#FFB627' },
  button: { name: '按钮SOS', color: '#FFB627' },
  unknown: { name: '其他', color: '#7B61FF' },
};

// 数据分析图表区块
function AnalyticsSection({ analytics }) {
  // 折线图数据 + 系列定义
  const lineData = (analytics?.last7days || []).map(row => ({
    date: row.date,
    active: row.active,
    sos: row.sos,
    recognitions: row.recognitions,
  }));
  const lineSeries = [
    { key: 'active', name: '活跃用户', color: '#00FFA3' },
    { key: 'sos', name: 'SOS事件', color: '#FF2E7E' },
    { key: 'recognitions', name: '识别次数', color: '#00E5FF' },
  ];

  // 环形图数据: SOS事件类型分布
  const donutData = (analytics?.sosDistribution || []).map(item => {
    const meta = SOS_TYPE_META[item.type] || SOS_TYPE_META.unknown;
    return { name: meta.name, value: item.count, color: meta.color };
  });

  // 柱状图数据: Agent调用次数分布
  const barData = (analytics?.agentStatus || []).map(agent => ({
    label: agent.name,
    value: agent.calls,
    color: agent.color || '#7B61FF',
  }));

  return (
    <div style={{
      background: 'var(--glass)', border: '1px solid var(--gb)', borderRadius: 16,
      padding: 20, marginBottom: 20, backdropFilter: 'blur(20px)',
    }}>
      <h3 style={{
        fontSize: '1rem', fontWeight: 600, margin: '0 0 16px',
        color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8
      }}>
        <span style={{
          display: 'inline-block', width: 4, height: 16, borderRadius: 2,
          background: 'linear-gradient(180deg, var(--bio-emerald), var(--bio-cyan))'
        }}></span>
        📈 数据分析
        <span style={{ marginLeft: 'auto', fontSize: '.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
          {analytics ? `更新于 ${new Date(analytics.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}` : '加载中...'}
        </span>
      </h3>

      {/* 折线图: 最近7天趋势 (占满宽度) */}
      <div style={{
        background: 'var(--void-3)', border: '1px solid var(--gb)',
        borderRadius: 12, padding: '14px 16px 8px', marginBottom: 12,
      }}>
        <div style={{ fontSize: '.78rem', color: 'var(--ink-soft)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 3, height: 12, background: 'var(--bio-emerald)', borderRadius: 2, display: 'inline-block' }}></span>
          最近7天活跃 / SOS / 识别趋势
        </div>
        {lineData.length > 0 ? (
          <LineChart data={lineData} series={lineSeries} height={200} />
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)', fontSize: '.78rem' }}>
            暂无趋势数据
          </div>
        )}
      </div>

      {/* 双列: 环形图(左) + 柱状图(右) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div style={{
          background: 'var(--void-3)', border: '1px solid var(--gb)',
          borderRadius: 12, padding: '14px 16px',
        }}>
          <div style={{ fontSize: '.78rem', color: 'var(--ink-soft)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 12, background: 'var(--bio-magenta)', borderRadius: 2, display: 'inline-block' }}></span>
            SOS事件类型分布
          </div>
          <DonutChart data={donutData} size={160} />
        </div>

        <div style={{
          background: 'var(--void-3)', border: '1px solid var(--gb)',
          borderRadius: 12, padding: '14px 16px',
        }}>
          <div style={{ fontSize: '.78rem', color: 'var(--ink-soft)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 12, background: 'var(--bio-violet)', borderRadius: 2, display: 'inline-block' }}></span>
            Agent调用次数分布
          </div>
          <BarChart data={barData} height={180} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, color, children }) {
  return (
    <div style={{
      background: 'var(--glass)', border: '1px solid var(--gb)',
      borderRadius: 14, padding: 20, backdropFilter: 'blur(20px)', marginBottom: 16
    }}>
      <h3 style={{ fontSize: '1rem', color, margin: '0 0 14px' }}>{title}</h3>
      {children}
    </div>
  );
}

function DevicesTab({ devices, sysInfo, devInfo }) {
  const recentSos = devices?.recentSos || [];
  const agents = devices?.agents || {};

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="📡 设备实时状态" color="var(--bio-emerald)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontSize: '.62rem', padding: '3px 8px', borderRadius: 4,
              background: devInfo.online ? 'rgba(0,255,163,0.1)' : 'rgba(255,46,126,0.1)',
              color: devInfo.online ? 'var(--bio-emerald)' : 'var(--bio-magenta)',
              fontFamily: 'Space Grotesk, monospace'
            }}>
              {devInfo.online ? '● ONLINE' : '● OFFLINE'}
            </span>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            电量: <strong style={{ color: 'var(--bio-amber)' }}>{devInfo.battery || 0}%</strong>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            当前活动: <strong>{devInfo.activity || '待机'}</strong>
          </div>
          {devInfo.location?.address && (
            <div style={{ fontSize: '.78rem', color: 'var(--ink-muted)', marginTop: 8 }}>
              📍 {devInfo.location.address}
            </div>
          )}
        </Panel>

        <Panel title="🤖 智能体状态" color="var(--bio-cyan)">
          {Object.entries(agents).length > 0 ? (
            Object.entries(agents).map(([key, agent]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--gb)' }}>
                <span style={{ fontSize: '.82rem' }}>{agent.name || key}</span>
                <span style={{
                  fontSize: '.68rem', padding: '2px 8px', borderRadius: 4,
                  background: agent.active ? 'rgba(0,255,163,0.1)' : 'rgba(136,147,168,0.1)',
                  color: agent.active ? 'var(--bio-emerald)' : 'var(--ink-muted)',
                  fontFamily: 'Space Grotesk, monospace'
                }}>
                  {agent.active ? '● ACTIVE' : '○ IDLE'}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>暂无智能体数据</div>
          )}
        </Panel>

        <Panel title="💾 系统统计" color="var(--bio-violet)">
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            路线记忆: <strong>{sysInfo.routes || 0}</strong>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            熟人面孔: <strong>{sysInfo.faces || 0}</strong>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            习惯记忆: <strong>{sysInfo.habits || 0}</strong>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 6 }}>
            AI配置: <strong style={{ color: sysInfo.traeConfigured ? 'var(--bio-emerald)' : 'var(--bio-magenta)' }}>
              {sysInfo.traeConfigured ? '✓ 已配置' : '✗ 未配置'}
            </strong>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
            运行模式: <strong>{sysInfo.mockMode ? '模拟模式' : '真实模式'}</strong>
          </div>
        </Panel>
      </div>

      <Panel title="🚨 最近SOS事件" color="var(--bio-magenta)">
        {recentSos.length > 0 ? (
          recentSos.map((sos, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--gb)' }}>
              <div>
                <span style={{ fontSize: '.82rem', color: 'var(--ink)' }}>{sos.event_type || 'SOS'}</span>
                {sos.address && <span style={{ fontSize: '.72rem', color: 'var(--ink-muted)', marginLeft: 8 }}>{sos.address}</span>}
              </div>
              <span style={{ fontSize: '.68rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
                {sos.created_at ? new Date(sos.created_at).toLocaleString('zh-CN', { hour12: false }) : ''}
              </span>
            </div>
          ))
        ) : (
          <div style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>✓ 暂无SOS事件</div>
        )}
      </Panel>
    </div>
  );
}

function AccountsTab({ accounts, currentUserId, setBanModal }) {
  return (
    <Panel title="👥 账号管理 (点击封禁/解封)" color="var(--bio-emerald)">
      {accounts.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--gb)' }}>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>ID</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>用户名</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>角色</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>手机号</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>状态</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--ink-muted)', fontSize: '.72rem' }}>注册时间</th>
                <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: '.72rem' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id} style={{ borderBottom: '1px solid var(--gb)' }}>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>{acc.id}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink)', fontWeight: 600 }}>{acc.username}</td>
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{
                      fontSize: '.68rem', padding: '2px 8px', borderRadius: 4,
                      background: acc.role === 'admin' ? 'rgba(255,46,126,0.1)' : acc.role === 'family' ? 'rgba(123,97,255,0.1)' : 'rgba(0,255,163,0.1)',
                      color: acc.role === 'admin' ? 'var(--bio-magenta)' : acc.role === 'family' ? 'var(--bio-violet)' : 'var(--bio-emerald)',
                    }}>
                      {acc.role === 'admin' ? '管理员' : acc.role === 'family' ? '家属' : '视障用户'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-soft)', fontFamily: 'Space Grotesk, monospace' }}>{acc.phone || '-'}</td>
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{
                      fontSize: '.68rem', padding: '2px 8px', borderRadius: 4,
                      background: acc.status === 'banned' ? 'rgba(255,46,126,0.1)' : 'rgba(0,255,163,0.1)',
                      color: acc.status === 'banned' ? 'var(--bio-magenta)' : 'var(--bio-emerald)',
                    }}>
                      {acc.status === 'banned' ? '🚫 已封禁' : '✓ 正常'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-muted)', fontSize: '.72rem' }}>
                    {acc.created_at ? new Date(acc.created_at).toLocaleDateString('zh-CN') : '-'}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    {acc.id === currentUserId ? (
                      <span style={{ fontSize: '.72rem', color: 'var(--ink-faint)' }}>当前账号</span>
                    ) : acc.role === 'admin' ? (
                      <span style={{ fontSize: '.72rem', color: 'var(--ink-faint)' }}>-</span>
                    ) : (
                      <button
                        onClick={() => setBanModal({ account: acc, action: acc.status === 'banned' ? 'unban' : 'ban' })}
                        style={{
                          padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          fontSize: '.72rem', fontFamily: 'inherit', fontWeight: 600,
                          background: acc.status === 'banned' ? 'rgba(0,255,163,0.15)' : 'rgba(255,46,126,0.15)',
                          color: acc.status === 'banned' ? 'var(--bio-emerald)' : 'var(--bio-magenta)',
                        }}
                      >
                        {acc.status === 'banned' ? '解封' : '封禁'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>暂无注册账号</div>
      )}
    </Panel>
  );
}

function LogsTab({ logs }) {
  return (
    <Panel title="📋 管理员操作日志" color="var(--bio-amber)">
      {logs.length > 0 ? (
        logs.map((log, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--gb)' }}>
            <div>
              <span style={{
                fontSize: '.68rem', padding: '2px 8px', borderRadius: 4, marginRight: 8,
                background: log.action === 'ban' ? 'rgba(255,46,126,0.1)' : 'rgba(0,255,163,0.1)',
                color: log.action === 'ban' ? 'var(--bio-magenta)' : 'var(--bio-emerald)',
              }}>
                {log.action === 'ban' ? '封禁' : '解封'}
              </span>
              <span style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
                账号ID: {log.target_account_id} · {log.reason || '无原因'}
              </span>
            </div>
            <span style={{ fontSize: '.68rem', color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>
              {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN', { hour12: false }) : ''}
            </span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>暂无操作日志</div>
      )}
    </Panel>
  );
}
