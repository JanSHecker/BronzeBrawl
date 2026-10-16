import logo from '../bronzeIcon150.png';

export default function BronzeLogo({ compact = false, decorative = false }) {
  return <span className={`brand-logo ${compact ? 'brand-logo-emblem' : 'brand-logo-full'}`}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'BronzeBrawl logo'} aria-hidden={decorative || undefined}>
    <img src={logo} alt="" />
    {!compact && <img className="brand-logo-wordmark" src={logo} alt="" />}
  </span>;
}
