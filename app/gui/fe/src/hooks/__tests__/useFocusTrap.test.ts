import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createRef(el: HTMLElement) {
    return { current: el };
  }

  function addButtons(parent: HTMLElement, count: number): HTMLButtonElement[] {
    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < count; i++) {
      const btn = document.createElement('button');
      btn.textContent = `Button ${i + 1}`;
      parent.appendChild(btn);
      buttons.push(btn);
    }
    return buttons;
  }

  it('focuses the first focusable element when activated', async () => {
    const buttons = addButtons(container, 3);
    const ref = createRef(container);

    renderHook(() => useFocusTrap(ref, true));

    // useFocusTrap defers via two requestAnimationFrame ticks so the focus
    // call lands after any sibling Suspense children stop fighting for focus.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('saves and restores focus on deactivation', async () => {
    // Start with focus on an external element
    const external = document.createElement('button');
    external.textContent = 'External';
    document.body.appendChild(external);
    external.focus();
    expect(document.activeElement).toBe(external);

    addButtons(container, 2);
    const ref = createRef(container);

    const { rerender } = renderHook(
      ({ active }) => useFocusTrap(ref, active),
      { initialProps: { active: true } },
    );

    await new Promise((r) => requestAnimationFrame(r));

    // Deactivate — should restore focus to external button
    rerender({ active: false });
    expect(document.activeElement).toBe(external);

    document.body.removeChild(external);
  });

  it('wraps Tab from last to first element', () => {
    const buttons = addButtons(container, 3);
    const ref = createRef(container);

    renderHook(() => useFocusTrap(ref, true));

    // Simulate focus on last element
    buttons[2].focus();
    expect(document.activeElement).toBe(buttons[2]);

    // Tab without shift on last element should wrap to first
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Shift+Tab from first to last element', () => {
    const buttons = addButtons(container, 3);
    const ref = createRef(container);

    renderHook(() => useFocusTrap(ref, true));

    // Simulate focus on first element
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);

    // Shift+Tab on first element should wrap to last
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('prevents Tab from leaving when container has no focusable elements', () => {
    // Container with no focusable children
    const ref = createRef(container);

    renderHook(() => useFocusTrap(ref, true));

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
  });

  it('does not trap keys when inactive', () => {
    const buttons = addButtons(container, 2);
    const ref = createRef(container);

    renderHook(() => useFocusTrap(ref, false));

    buttons[1].focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    // Should NOT be prevented since trap is inactive
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('does not auto-focus or trap Tab when isTopmost is false', async () => {
    const buttons = addButtons(container, 3);
    const ref = createRef(container);
    // Park focus elsewhere to detect any stomping.
    const external = document.createElement('button');
    external.textContent = 'External';
    document.body.appendChild(external);
    external.focus();

    renderHook(() => useFocusTrap(ref, true, { isTopmost: false }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // External focus untouched — the parent trap released for a child.
    expect(document.activeElement).toBe(external);

    // Tab is not intercepted either.
    buttons[2].focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(preventSpy).not.toHaveBeenCalled();

    document.body.removeChild(external);
  });

  it('focuses the initial element specified via options.initialFocusRef', async () => {
    const buttons = addButtons(container, 3);
    const ref = createRef(container);
    const initialRef = createRef(buttons[2]);

    renderHook(() => useFocusTrap(ref, true, { initialFocusRef: initialRef }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(document.activeElement).toBe(buttons[2]);
  });

  it('skips disabled buttons in focusable query', () => {
    const btn1 = document.createElement('button');
    btn1.textContent = 'Enabled';
    container.appendChild(btn1);

    const btn2 = document.createElement('button');
    btn2.textContent = 'Disabled';
    btn2.disabled = true;
    container.appendChild(btn2);

    const btn3 = document.createElement('button');
    btn3.textContent = 'Also Enabled';
    container.appendChild(btn3);

    const ref = createRef(container);
    renderHook(() => useFocusTrap(ref, true));

    // Focus on last enabled button
    btn3.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    // Should wrap to first enabled button (skipping disabled)
    expect(document.activeElement).toBe(btn1);
  });
});
