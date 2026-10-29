import { Link } from 'react-router-dom';

export function PrimaryLink({ to, children, className = '', ...props }) {
  return <Link to={to} className={`button button--primary ${className}`} {...props}>{children}</Link>;
}

export function SecondaryLink({ to, children, className = '', ...props }) {
  return <Link to={to} className={`button button--secondary ${className}`} {...props}>{children}</Link>;
}

export function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  return <button type={type} className={`button button--${variant} ${className}`} {...props}>{children}</button>;
}
