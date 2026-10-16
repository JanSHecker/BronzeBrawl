export default function SelectionTitle({ src, alt }) {
  return <span className="selection-title" role="img" aria-label={alt}>
    <img src={src} alt="" />
    <img className="selection-title-text" src={src} alt="" />
  </span>;
}
