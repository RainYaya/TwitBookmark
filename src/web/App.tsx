import { useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Keymap } from './components/Keymap.js';
import { useKeymap } from './lib/keys.js';
import Library from './routes/Library.js';
import Settings from './routes/Settings.js';
import Twitter from './routes/Twitter.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link';

function Shell() {
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);

  const handlers: Record<string, (event: KeyboardEvent) => void> = help
    ? {
        Escape: (event) => {
          event.stopImmediatePropagation();
          setHelp(false);
        },
        '?': () => setHelp(false),
      }
    : {
        'g t': () => navigate('/'),
        'g l': () => navigate('/library'),
        'g s': () => navigate('/settings'),
        '?': () => setHelp(true),
      };
  useKeymap(handlers);

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="brand">
          TwitBookmark
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end className={navClass}>
            推特流
          </NavLink>
          <NavLink to="/library" className={navClass}>
            库
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            设置
          </NavLink>
        </nav>
        <button
          type="button"
          className="link-button"
          aria-label="键位帮助"
          onClick={() => setHelp((value) => !value)}
        >
          ? 键位
        </button>
      </header>

      <Routes>
        <Route path="/" element={<Twitter />} />
        <Route path="/library" element={<Library />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      {help ? <Keymap onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
