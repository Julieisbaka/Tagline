import { useState } from 'react';

export default function SettingsGroup({ title, children, className = '' }) {
  const [open, setOpen] = useState(true);
  return (
    <details
      className={`settings-group ${className}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      <div className='settings-group-content'>{children}</div>
    </details>
  );
}
