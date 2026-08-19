import { describe, expect, it } from 'vitest';
import { evaluateGate } from '@videox/shared';

const vod = { kind: 'vod' as const, status: 'ready' as const, visibility: 'public' as const };
const shorts = { kind: 'shorts' as const, status: 'ready' as const, visibility: 'public' as const };

describe('点播会员门禁', () => {
  it('会员和管理员可播点播', () => {
    expect(evaluateGate(vod, { userId: 'u', isVip: true, isAdmin: false })).toEqual({
      canPlay: true,
      gateReason: null,
    });
    expect(evaluateGate(vod, { userId: 'a', isVip: false, isAdmin: true })).toEqual({
      canPlay: true,
      gateReason: null,
    });
  });

  it('游客与已登录非会员都不能播点播', () => {
    expect(evaluateGate(vod, { userId: null, isVip: false, isAdmin: false })).toEqual({
      canPlay: false,
      gateReason: 'vip_required',
    });
    expect(evaluateGate(vod, { userId: 'u', isVip: false, isAdmin: false })).toEqual({
      canPlay: false,
      gateReason: 'vip_required',
    });
  });

  it('未就绪或私密点播不可播', () => {
    expect(evaluateGate({ ...vod, status: 'transcoding' }, { userId: null, isVip: false, isAdmin: false })).toEqual({
      canPlay: false,
      gateReason: 'unavailable',
    });
    expect(evaluateGate({ ...vod, visibility: 'private' }, { userId: null, isVip: false, isAdmin: false })).toEqual({
      canPlay: false,
      gateReason: 'unavailable',
    });
  });
});

describe('Shorts 详情层放行', () => {
  it('游客也可起播 Shorts（额度在票据层扣）', () => {
    expect(evaluateGate(shorts, { userId: null, isVip: false, isAdmin: false })).toEqual({
      canPlay: true,
      gateReason: null,
    });
  });

  it('未就绪 Shorts 仍不可播', () => {
    expect(evaluateGate({ ...shorts, status: 'queued' }, { userId: null, isVip: false, isAdmin: false })).toEqual({
      canPlay: false,
      gateReason: 'unavailable',
    });
  });
});
