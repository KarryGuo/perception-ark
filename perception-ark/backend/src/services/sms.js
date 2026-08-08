/**
 * 短信服务模块
 * 支持通过 SMS_PROVIDER 环境变量配置短信服务商
 * - none(默认): 仅记录日志,不发送真实短信(开发/演示模式)
 * - aliyun: 阿里云短信服务(需配置 ALIYUN_SMS_* 环境变量)
 * - tencent: 腾讯云短信服务(预留,需配置 TENCENT_SMS_* 环境变量)
 */
import { log } from '../utils/logger.js';

const PROVIDER = (process.env.SMS_PROVIDER || 'none').toLowerCase();

/**
 * 发送家属邀请短信
 * 邀请家属注册感知方舟家属端
 * @param {string} phone 家属手机号
 * @param {string} inviterName 邀请人名称
 * @returns {Promise<{ success: boolean, simulated?: boolean, error?: string }>}
 */
export async function sendFamilyInviteSms(phone, inviterName) {
  if (!phone) return { success: false, error: '手机号不能为空' };
  const inviter = inviterName || '感知方舟用户';

  if (PROVIDER === 'none') {
    // 降级模式: 仅记录日志,不发送真实短信
    log('SMS', `[降级模式] 家属邀请短信 -> ${phone}: ${inviter} 邀请您注册感知方舟家属端,注册后即可查看家人动态与SOS求助。`);
    return { success: true, simulated: true };
  }

  if (PROVIDER === 'aliyun') {
    return sendAliyunSms(phone, inviter);
  }

  if (PROVIDER === 'tencent') {
    // 腾讯云短信: 预留接口,生产环境接入腾讯云SMS SDK
    log('SMS', `[腾讯云SMS] 家属邀请短信 -> ${phone} (邀请人: ${inviter}) - 待接入SDK`);
    return { success: true, simulated: true };
  }

  // 未知provider,降级为日志
  log('SMS', `[未知SMS_PROVIDER=${PROVIDER}] 家属邀请短信 -> ${phone} (邀请人: ${inviter})`);
  return { success: true, simulated: true };
}

/**
 * 阿里云短信发送(需配置环境变量)
 * ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET
 * ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_INVITE_TEMPLATE_CODE
 */
async function sendAliyunSms(phone, inviterName) {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_INVITE_TEMPLATE_CODE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    log('SMS', `[阿里云SMS] 环境变量未配置完整,降级为日志模式 -> ${phone} (邀请人: ${inviterName})`);
    return { success: true, simulated: true };
  }

  try {
    // 动态导入阿里云SDK(避免未安装时启动报错)
    const dysmsapi = await import('@alicloud/dysmsapi20170525').catch(() => null);
    if (!dysmsapi) {
      log('SMS', `[阿里云SMS] SDK未安装(@alicloud/dysmsapi20170525),降级为日志 -> ${phone}`);
      return { success: true, simulated: true };
    }
    const Config = (await import('@alicloud/openapi-client')).default.Config;
    const config = new Config({ accessKeyId, accessKeySecret });
    const client = new dysmsapi.default(config);
    const SendSmsRequest = (await import('@alicloud/dysmsapi20170525')).SendSmsRequest;
    const req = new SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: JSON.stringify({ name: inviterName }),
    });
    const resp = await client.sendSms(req);
    if (resp.body?.code === 'OK') {
      log('SMS', `[阿里云SMS] 家属邀请短信发送成功 -> ${phone} (邀请人: ${inviterName})`);
      return { success: true };
    }
    log('SMS', `[阿里云SMS] 发送失败: ${resp.body?.message || '未知错误'} -> ${phone}`, 'error');
    return { success: false, error: resp.body?.message || '短信发送失败' };
  } catch (err) {
    log('SMS', `[阿里云SMS] 发送异常: ${err.message} -> ${phone}`, 'error');
    return { success: false, error: err.message };
  }
}