/** DOM helper kit handed to generated panels, plus the React host that mounts them safely. */
import { useEffect, useRef, useState } from 'react';
import type { CampaignState, Loose, BattleState, UnitState } from '../../engine/types';
import { bodySvg } from './sprites';

type Child = Node | string | number | null | undefined | false | Child[];

export function h(tag: string, props: Record<string, Loose> | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(String(tag || 'div'));
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'class' || key === 'className') el.className = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'style') el.setAttribute('style', String(value));
    else if (key === 'html') continue; // no raw HTML injection: generated text is rendered as text
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  const append = (child: Child): void => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(append); return; }
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(append);
  return el;
}

export function meter(value: number, max: number, label = ''): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100)) : 0;
  return h('span', { class: 'ext-meter', role: 'meter', 'aria-valuenow': value, 'aria-valuemax': max, title: label },
    h('span', { class: 'ext-meter-fill', style: { width: `${pct}%` } }), label ? h('span', { class: 'ext-meter-label' }, label) : null);
}

export function spriteNode(unit: Loose, size = 40): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'ext-sprite';
  wrap.style.width = `${size}px`; wrap.style.height = `${size}px`;
  wrap.innerHTML = bodySvg(unit ?? {}, size); // generated locally from data, never from module strings
  return wrap;
}

export interface PanelEnv {
  campaign: CampaignState;
  battle: BattleState | null;
  selected: UnitState | null;
  send: (command: string, args: Loose) => Promise<void>;
  battleSend: (command: string, args: Loose) => Promise<void>;
  sound: (id: string) => void;
}

export function makeUi(env: PanelEnv): Loose {
  return { h, meter, sprite: spriteNode, ...env };
}

/** Mounts a generated render(ui) function; errors are contained and shown inline. */
export function ExtensionView({ render, env, moduleId, testId }: { render: (ui: Loose) => Loose; env: PanelEnv; moduleId: string; testId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    try {
      const node = render(makeUi(env));
      el.replaceChildren(node instanceof Node ? node : document.createTextNode(node === undefined || node === null ? '' : String(node)));
      setError(null);
    } catch (e) {
      el.replaceChildren();
      setError(e instanceof Error ? e.message : String(e));
    }
  });
  return (
    <div className="ext-host" data-testid={testId} data-module={moduleId}>
      <div ref={host} />
      {error && <p className="field-warning" role="alert">This view from “{moduleId}” failed to draw: {error}. The game keeps running; a helper can repair it.</p>}
    </div>
  );
}
