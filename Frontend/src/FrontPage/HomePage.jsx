import { Link } from 'react-router-dom';
import BronzeLogo from '../components/BronzeLogo';

export default function HomePage() {
  return <main className="home-page">
    <h1 className="sr-only">BronzeBrawl</h1>
    <BronzeLogo />
    <nav className="home-actions" aria-label="Get started">
      <Link className="btn btn-primary entry-action" to="/join">Join</Link>
      <Link className="btn entry-action entry-secondary" to="/host">Host</Link>
    </nav>
  </main>;
}
