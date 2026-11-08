import { useState } from 'react';

export default function SettingsGroup({ title, children, className = '', collapsible = true }) {
  const [open, setOpen] = useState(true);
  const classes =
    `settings-group${collapsible ? '' : ' settings-group-static'} ${className}`.trim();
  if (!collapsible) {
    return (
      <section className={classes}>
        <h3 className='settings-group-heading'>{title}</h3>
        <div className='settings-group-content'>{children}</div>
      </section>
    );
  }
  return (
    <details
      className={classes}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      <div className='settings-group-content'>{children}</div>
    </details>
  );
}
