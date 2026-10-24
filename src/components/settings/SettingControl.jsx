export default function SettingControl({ setting, value, onChange, ...attributes }) {
  return <label className="setting-row">
    <span>{setting.title}{setting.description && <small>{setting.description}</small>}</span>
    {setting.enum ? <select {...attributes} value={value} onChange={(event) => onChange(event.target.value)}>
      {setting.enum.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
    </select> : <input {...attributes}
      type={setting.type === 'boolean' ? 'checkbox' : setting.type === 'number' ? 'number' : 'text'}
      {...(setting.type === 'boolean' ? { checked: value } : { value })}
      min={setting.min} max={setting.max} maxLength={setting.maxLength ?? 1000} step="any"
      onChange={(event) => onChange(setting.type === 'boolean' ? event.target.checked : event.target.value)} />}
  </label>;
}
