import Link from 'next/link';
export default function NotFound() {
  return <div className="center-page"><div className="work-card" style={{textAlign:'center'}}>
    <h2>Page not found</h2>
    <p style={{color:'var(--ink-3)',marginBottom:20}}>The page you are looking for does not exist or has been moved.</p>
    <div style={{display:'flex',gap:8,justifyContent:'center'}}>
      <Link className="btn btn-primary" href="/dashboard">Go to workspace</Link>
      <Link className="btn btn-ghost" href="/">Home</Link>
    </div>
  </div></div>;
}
