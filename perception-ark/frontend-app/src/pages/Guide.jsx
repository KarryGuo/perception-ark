import { useAuth } from '../hooks/useAuth.jsx';

const FEATURES = [
  { icon: '👁️', title: '场景感知 (A01)', desc: '实时描述前方路面状况、主要物体及距离,帮助视障用户"看见"周围环境。', color: '#00FFA3' },
  { icon: '🧭', title: '导航引导 (A02)', desc: '语音输入目的地,自动规划步行路线,逐步语音引导。支持POI搜索和路线记忆。', color: '#FFB627' },
  { icon: '🛡️', title: '安全预警 (A03)', desc: '检测靠近的车辆、障碍物、高空坠物等危险。跌倒自动触发SOS,10秒倒计时联系紧急联系人。', color: '#FF2E7E' },
  { icon: '📖', title: '文字识别 (A04)', desc: '读取菜单、招牌、药盒、价签等文字信息,并记录常用偏好。', color: '#7B61FF' },
  { icon: '👤', title: '人脸识别 (A04)', desc: '识别面前的熟人,播报关系和姓名,记录上次见面时间。新面孔自动入库。', color: '#7B61FF' },
  { icon: '🧠', title: '环境记忆 (A05)', desc: '学习常用路线、熟人面孔、生活偏好,提供个性化记忆辅助。', color: '#00E5FF' }
];

const STEPS = [
  '注册账号并登录系统(使用者或家属角色)',
  '系统自动定位您的位置并播报天气问候',
  '说"小舟小舟"唤醒智能助手,进入对话模式',
  '直接说出需求,如"带我去五一广场"、"读一下面前的菜单"、"前面是谁"',
  '系统自动调用对应Agent处理,语音播报结果',
  '跌倒时自动触发SOS,说"我没事"可取消'
];

export default function Guide() {
  const { user, logout } = useAuth();

  return (
    <div className="guide-page">
      <div className="guide-header">
        <h1>感知方舟 · 产品使用说明</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {user ? (
            <>
              <span style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>{user.username}</span>
              <a href="#/">进入系统</a>
              <a href="#/" onClick={logout} style={{ color: 'var(--bio-magenta)' }}>退出</a>
            </>
          ) : (
            <>
              <a href="#/login">登录</a>
              <a href="#/register">注册</a>
            </>
          )}
        </div>
      </div>

      <div className="guide-content">
        <div className="guide-section">
          <h2>产品简介</h2>
          <p>感知方舟(PerceptionArk)是一款基于TRAE多智能体架构的AI感知眼镜系统,专为视障人群设计。系统通过摄像头实时感知环境,结合大语言模型和视觉模型,提供场景描述、智能导航、安全预警、文字识别、人脸识别和环境记忆六大核心能力。</p>
          <p>系统采用五Agent协同架构,通过优先级仲裁机制确保安全预警(P0)可抢占任何低优先级任务,保障视障用户出行安全。</p>
        </div>

        <div className="guide-section">
          <h2>核心功能</h2>
          <div className="guide-feature-grid">
            {FEATURES.map(f => (
              <div className="guide-feature-card" key={f.title}>
                <div className="gfc-icon">{f.icon}</div>
                <div className="gfc-title" style={{ color: f.color }}>{f.title}</div>
                <div className="gfc-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="guide-section">
          <h2>使用流程</h2>
          <ul>
            {STEPS.map((s, i) => (
              <li key={i}>{i + 1}. {s}</li>
            ))}
          </ul>
        </div>

        <div className="guide-section">
          <h2>语音指令示例</h2>
          <h3>导航类</h3>
          <ul>
            <li>"带我去五一广场" — 规划步行路线</li>
            <li>"我要去附近的超市" — 搜索周边POI并导航</li>
            <li>"怎么去长沙火车站" — 全局搜索目的地</li>
          </ul>
          <h3>识物类</h3>
          <ul>
            <li>"读一下面前的菜单" — OCR文字识别</li>
            <li>"前面是谁" — 人脸识别</li>
            <li>"描述一下当前场景" — 场景感知</li>
          </ul>
          <h3>安全类</h3>
          <ul>
            <li>"检查一下安全" — 主动安全扫描</li>
            <li>"我没事" — 取消SOS倒计时</li>
          </ul>
          <h3>记忆类</h3>
          <ul>
            <li>"我之前去过哪里" — 检索路线记忆</li>
            <li>"上次见了谁" — 检索熟人记忆</li>
          </ul>
        </div>

        <div className="guide-section">
          <h2>多端访问</h2>

          {/* 评委手机扫码体验区 */}
          <div className="guide-qr-section">
            <div className="guide-qr-card">
              <div className="guide-qr-title">📱 评委手机扫码体验</div>
              <div className="guide-qr-desc">用手机扫描下方二维码,一键进入移动端APP,模拟盲人眼镜使用</div>
              <div className="guide-qr-img">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&color=04060C&bgcolor=FFFFFF&data=${encodeURIComponent(window.location.origin + window.location.pathname + '#/demo')}`}
                  alt="扫码体验移动端APP"
                  width="200"
                  height="200"
                />
              </div>
              <div className="guide-qr-tip">扫码后自动登录,直达识别/导航/SOS界面</div>
              <a href="#/demo" className="guide-qr-link">或在当前设备一键体验 →</a>
            </div>
          </div>

          <h3>Web端(评委展示)</h3>
          <p>展示眼镜后台工作原理,包括五Agent协同、优先级抢占、实时事件流、地图导航可视化。适合评委了解系统架构和工作流程。</p>
          <p><a href="#/" style={{ color: 'var(--bio-emerald)' }}>前往Web端 →</a></p>

          <h3>H5移动端(用户使用)</h3>
          <p>精简版界面,聚焦识物和导航核心功能。手机扫码即可访问,适合视障用户日常使用。三大模式:识别(场景/文字/人脸/红绿灯)、导航(3D地图+语音)、SOS紧急呼救。</p>
          <p><a href="#/app" style={{ color: 'var(--bio-emerald)' }}>前往H5移动端 →</a></p>

          <h3>家属端</h3>
          <p>家属可查看使用者实时位置、活动状态、SOS历史,管理紧急联系人信息。</p>
          <p><a href="#/family" style={{ color: 'var(--bio-emerald)' }}>前往家属端 →</a></p>
        </div>

        <div className="guide-section">
          <h2>技术架构</h2>
          <p>前端: React 18 + Vite,高德地图JS API,Web Speech API(语音识别/合成)</p>
          <p>后端: Node.js + Express + WebSocket,better-sqlite3(记忆存储),JWT(认证)</p>
          <p>AI能力: 火山方舟(ARK) — doubao-1.5-pro-32k(文本),doubao-1.5-vision-pro-32k(视觉)</p>
          <p>地图服务: 高德地图 — 步行路径规划,POI搜索,逆地理编码,天气查询</p>
        </div>
      </div>
    </div>
  );
}
