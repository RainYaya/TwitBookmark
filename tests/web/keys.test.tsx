// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useKeymap } from '../../src/web/lib/keys.js';

function Harness({ onKey }: { onKey: (key: string) => void }) {
  useKeymap({
    j: () => onKey('j'),
    x: () => onKey('x'),
    'g t': () => onKey('g t'),
    'g l': () => onKey('g l'),
  });
  return null;
}

describe('useKeymap', () => {
  it('fires a direct key', () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    fireEvent.keyDown(document, { key: 'j' });
    expect(onKey).toHaveBeenCalledWith('j');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('fires a g prefix combination once', () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    fireEvent.keyDown(document, { key: 'g' });
    fireEvent.keyDown(document, { key: 't' });
    expect(onKey).toHaveBeenCalledWith('g t');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into an input', () => {
    const onKey = vi.fn();
    render(
      <>
        <Harness onKey={onKey} />
        <input aria-label="search" />
      </>,
    );
    const input = document.querySelector('input')!;
    input.focus();
    fireEvent.keyDown(input, { key: 'j' });
    fireEvent.keyDown(input, { key: 'x' });
    expect(onKey).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const onKey = vi.fn();
    function Disabled() {
      const [enabled] = useState(false);
      useKeymap({ j: () => onKey('j') }, { enabled });
      return null;
    }
    render(<Disabled />);
    fireEvent.keyDown(document, { key: 'j' });
    expect(onKey).not.toHaveBeenCalled();
  });
});
