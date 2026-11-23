import { Brand } from '../components/Brand.jsx';
import './auth.css';

export function Home() {
  return (
    <div className="auth-shell">
      <header className="auth-header home-header">
        <Brand href="#home" />
        <nav aria-label="Public navigation">
          <a
            className="text-button"
            href="https://github.com/Faizan-902/PulseCheck"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a className="secondary-button" href="#signin">
            Sign in
          </a>
        </nav>
      </header>
      <main className="home-hero">
        <div className="home-copy">
          <h1>Know when your APIs need attention.</h1>
          <p>
            Monitor public endpoints, explore response times, and follow incidents from first failure to
            recovery.
          </p>
          <a className="primary-button" href="#signup">
            Create your account
          </a>
        </div>
        <img src="/images/pulsecheck-glass.jpg" width="1200" height="800" fetchPriority="high" alt="" />
      </main>
    </div>
  );
}
