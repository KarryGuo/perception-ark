import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api.js';

/**
 * LVA (Language-Vision-Action) 推理过程展示
 *
 * 工作模式:
 * 1. 摄像头开启时,每 8 秒自动抓拍一帧
 * 2. 调用后端 A01 场景感知 Agent 进行视觉理解
 * 3. 实时展示推理流水线: 视觉捕获 → 环境理解 → 协调推理 → 路径规划
 * 4. 当外部 Agent(导航/OCR等)被触发时,自动切换到对应的推理步骤
 */
const PIPELINE = [
  {
    id: 'capture',
    name: '视觉捕获',
    icon: '📷',
    desc: '摄像头帧采集 → 720p',
    detail: '采集眼镜摄像头实时画面，输入多模态视觉模型'
  },
  {
    id: 'perceive',
    name: '环境理解',
    icon: '👁️',
    desc: '千问全模态 · 场景识别',
    detail: 'VLM解析：物体·距离·路面·场景类型'
  },
  {
    id: 'reason',
    name: '协调推理',
    icon: '🧠',
    desc: 'Orchestrator · 意图识别',
    detail: '中央调度器根据场景+意图分配Agent'
  },
  {
    id: 'plan',
    name: '行动规划',
    icon: '🧭',
    desc: '路径规划 · 输出指令',
    detail: '生成导航路径或避障指令'
  }
];

export default function LVAProcess({ cameraActive, onCaptureFrame, activeAgent, externalBusy, sceneOutput, routeInfo }) {
  const [activeStep, setActiveStep] = useState(-1);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState('');
  const [lastFrameTime, setLastFrameTime] = useState(null);
  const stepTimerRef = useRef(null);
  const captureTimerRef = useRef(null);
  const stepIdxRef = useRef(0);

  // 摄像头开启时定时抓拍分析
  const analyzeFrame = useCallback(async () => {
    if (analyzing) return;
    if (!onCaptureFrame) return;

    setAnalyzing(true);
    stepIdxRef.current = 0;
    setActiveStep(0);

    try {
      // 步骤推进: 0(捕获) → 1(理解) → 2(推理) → 3(规划)
      stepTimerRef.current = setInterval(() => {
        stepIdxRef.current = Math.min(stepIdxRef.current + 1, PIPELINE.length - 1);
        setActiveStep(stepIdxRef.current);
      }, 1500);

      // 调用摄像头抓拍
      const file = await onCaptureFrame();
      if (!file) {
        setLastAnalysis('未获取到画面');
        return;
      }

      // 调用后端场景感知 (返回 {success, result} 对象)
      const resp = await api.scene(file, '请用一段话描述当前场景，包括：路面状况、前方主要物体及大致距离、场景类型(室内/室外/路口)。专为视障者设计。50字以内。');
      const resultText = (resp && resp.result) ? resp.result : '视觉分析未返回内容，请检查API配置';
      setLastAnalysis(resultText);
      setLastFrameTime(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (err) {
      setLastAnalysis(`分析失败: ${err.message}`);
    } finally {
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      setActiveStep(-1);
      setAnalyzing(false);
    }
  }, [analyzing, onCaptureFrame]);

  // 摄像头开启时定时分析(每10秒),busy时跳过避免与手动操作冲突
  useEffect(() => {
    if (!cameraActive) {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      return;
    }
    // 首次延迟2秒启动
    const firstTimer = setTimeout(() => {
      analyzeFrame();
      captureTimerRef.current = setInterval(() => {
        // busy时跳过当前周期,等用户操作完成后再恢复
        if (externalBusy || analyzing) return;
        analyzeFrame();
      }, 10000);
    }, 2000);
    return () => {
      clearTimeout(firstTimer);
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };
  }, [cameraActive, analyzeFrame, externalBusy, analyzing]);

  // 外部触发(场景按钮/导航等)时,临时展示推理流程
  useEffect(() => {
    if (externalBusy) {
      stepIdxRef.current = 0;
      setActiveStep(0);
      stepTimerRef.current = setInterval(() => {
        stepIdxRef.current = Math.min(stepIdxRef.current + 1, PIPELINE.length - 1);
        setActiveStep(stepIdxRef.current);
      }, 1500);
    } else if (!analyzing) {
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      setActiveStep(-1);
    }
    return () => {
      if (stepTimerRef.current && !externalBusy && !analyzing) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [externalBusy, analyzing]);

  // 清理
  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    };
  }, []);

  const isActive = analyzing || externalBusy;

  return (
    <div className="lva-panel">
      <div className="lva-header">
        <span className="lva-dot"></span>
        <span className="lva-title">LVA · 视觉推理</span>
        <span className="lva-status">
          {analyzing ? 'ANALYZING' : externalBusy ? 'PROCESSING' : cameraActive ? 'STANDBY' : 'IDLE'}
        </span>
      </div>

      <div className="lva-pipeline">
        {PIPELINE.map((step, i) => (
          <div
            key={step.id}
            className={`lva-step ${i === activeStep && isActive ? 'active' : ''} ${isActive && i < activeStep ? 'done' : ''}`}
          >
            <div className="lva-step-head">
              <span className="lva-step-icon">{step.icon}</span>
              <div className="lva-step-info">
                <div className="lva-step-name">{step.name}</div>
                <div className="lva-step-desc">{step.desc}</div>
              </div>
              <span className="lva-step-idx">0{i + 1}</span>
            </div>
            {(i === activeStep && isActive) && (
              <div className="lva-step-detail">
                <div className="lva-step-bar"><div className="lva-step-bar-fill"></div></div>
                <div className="lva-step-text">{step.detail}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 实时分析结果 */}
      {(lastAnalysis || sceneOutput || routeInfo) && (
        <div className="lva-output">
          {lastAnalysis && (
            <div className="lva-output-row">
              <span className="lva-output-tag">LIVE</span>
              <span className="lva-output-text">
                {lastAnalysis}
                {lastFrameTime && <span className="lva-output-time"> · {lastFrameTime}</span>}
              </span>
            </div>
          )}
          {sceneOutput && sceneOutput !== lastAnalysis && (
            <div className="lva-output-row">
              <span className="lva-output-tag">SCENE</span>
              <span className="lva-output-text">{typeof sceneOutput === 'string' ? sceneOutput : JSON.stringify(sceneOutput)}</span>
            </div>
          )}
          {routeInfo && (
            <div className="lva-output-row">
              <span className="lva-output-tag">ROUTE</span>
              <span className="lva-output-text">{typeof routeInfo === 'string' ? routeInfo : JSON.stringify(routeInfo)}</span>
            </div>
          )}
        </div>
      )}

      {/* 摄像头未开启提示 */}
      {!cameraActive && (
        <div className="lva-hint">
          启动左侧摄像头后，LVA将自动分析画面
        </div>
      )}
    </div>
  );
}
