import { describe, expect, it } from 'vitest';
import { resolveLanguage, withLanguage } from './index';
import { translate } from './translate';
import { messages } from './messages';
import { buildInterpretMessages } from '../core/ai';
import { resultAoa } from '../core/export';
import type { AnalysisOutput } from '../core/types';

describe('shared WispLab language contract', () => {
  it('gives valid URL values priority, falls back to storage, then Chinese', () => {
    expect(resolveLanguage('?lang=en&x=1', 'zh')).toBe('en');
    expect(resolveLanguage('?lang=zh', 'en')).toBe('zh');
    expect(resolveLanguage('?lang=invalid', 'en')).toBe('en');
    expect(resolveLanguage('', 'invalid')).toBe('zh');
    expect(resolveLanguage('', null)).toBe('zh');
  });
  it('carries language across sites without removing query or fragment', () => {
    expect(withLanguage('https://wb.wisplab.top/?mode=single#results', 'en')).toBe('https://wb.wisplab.top/?mode=single&lang=en#results');
  });
  it('keeps scientific symbols and interpolated user names intact', () => {
    expect(translate('内参基因未在数据中出现：{0}', 'en', ['中文GAPDH'])).toBe('Reference genes missing from the data: 中文GAPDH');
    expect(translate('内参基因未在数据中出现：中文GAPDH', 'en')).toBe('Reference genes missing from the data: 中文GAPDH');
    expect(translate('对照组样本（我的样本）的内参基因均未检出——无法计算 ΔΔCt，请改用其他内参基因', 'en')).toContain('我的样本');
    expect(translate('', 'zh')).toBe('');
  });
  it('localizes stored quality messages and nested statistical suffixes', () => {
    expect(translate('发现 2 个严重问题、3 个警告，建议处理后重新分析', 'en')).toBe('Found 2 errors and 3 warnings; address them before reanalyzing');
    expect(translate('我的基因：NTC 提前扩增（最低 Cq 33.1）——疑似试剂或环境污染，该基因结果不可信', 'en')).toBe("我的基因: Early NTC amplification (lowest Cq 33.1) — possible reagent or environmental contamination; this target's results are unreliable");
    expect(translate('单因素 ANOVA（F=2.50, df=2/9）；Dunnett vs 对照；FC 经 Pfaffl 效率校正', 'en')).toBe('One-way ANOVA (F=2.50, df=2/9); Dunnett vs control; FC corrected for efficiency using Pfaffl');
  });
  it('provides English for every dictionary entry and retains template slots', () => {
    for (const [zh, en] of Object.entries(messages)) {
      expect(en, zh).not.toMatch(/\p{Script=Han}/u);
      expect([...en.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(), zh).toEqual([...zh.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort());
    }
  });

  it('translates every interpolated catalog message with the same placeholders', () => {
    const values = ['X0','X1','X2','X3','X4'];
    const fill = (source: string) => source.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)]);
    for (const [zh, en] of Object.entries(messages)) {
      if (/\{\d+\}/.test(zh)) expect(translate(fill(zh), 'en'), zh).toBe(fill(en));
    }
  });
  it('requests English interpretation only when selected, without changing submitted data', () => {
    const payload = { sample: '中文样本', value: 1.234 };
    const en = buildInterpretMessages(payload, 'en');
    expect(en[0].content).toContain('in English');
    expect(en[0].content).not.toMatch(/\p{Script=Han}/u);
    expect(en[1].content).toBe(JSON.stringify(payload));
    expect(buildInterpretMessages(payload)[0].content).toContain('请用中文');
  });
  it('localizes exported headings only and leaves user fields and numbers intact', () => {
    const out = { results: [{target:'中文基因',sample:'中文样本',group:'组别',isControl:true,n:3,wells:['A1'],meanCq:20,sdCq:.1,refCq:18,deltaCt:2,ddCt:0,foldChange:1,fcSd:.2,pValue:null,pAdjusted:null,significance:'ns',statMethod:'Welch t'}] } as AnalysisOutput;
    const en = resultAoa(out, 'en');
    expect(en[0][0]).toBe('Target');
    expect(en[1].slice(0,5)).toEqual(['中文基因','中文样本','组别','Yes',3]);
    expect(en[1][11]).toBe('1');
    expect(resultAoa(out)[0][0]).toBe('基因 Target');
  });
});
