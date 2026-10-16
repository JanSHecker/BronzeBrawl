import { Link } from 'react-router-dom';
import BronzeLogo from './BronzeLogo';

export default function EntryPage({ children, host = false }) {
  return <main className={`entry-shell${host ? ' entry-shell-host' : ''}`}>
    <header className="entry-header">
      <Link className="entry-back" to="/">← Back</Link>
      <BronzeLogo compact />
    </header>
    {children}
  </main>;
}
