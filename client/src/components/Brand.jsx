import { Icon } from './Icon.jsx';

export function Brand({ href, onClick }) {
  return (
    <a className="brand" href={href} onClick={onClick}>
      <span className="brand-mark">
        <Icon name="pulse" size={19} />
      </span>
      <span>PulseCheck</span>
    </a>
  );
}
