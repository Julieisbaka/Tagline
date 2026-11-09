export default function SettingControl({ setting, value, onChange, extensionId, ...attributes }) {
  const description = (text) => {
    const match = /\[([^\]]{1,100})\]\((https?:\/\/[^\s)]+)\)/.exec(text);
    if (!match) return text;
    return (
      <>
        {text.slice(0, match.index)}
        <a href={match[2]} target='_blank' rel='noreferrer'>
          {match[1]}
        </a>
        {text.slice(match.index + match[0].length)}
      </>
    );
  };
  return (
    <label className='setting-row'>
      <span>
        {setting.title}
        {setting.description && <small>{description(setting.description)}</small>}
      </span>
      {setting.enum ? (
        <select {...attributes} value={value} onChange={(event) => onChange(event.target.value)}>
          {setting.enum.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : ['array', 'object'].includes(setting.type) ? (
        <textarea
          {...attributes}
          value={JSON.stringify(value, null, 2)}
          onChange={(event) => {
            try {
              onChange(JSON.parse(event.target.value));
            } catch {
              onChange(event.target.value);
            }
          }}
        />
      ) : setting.type === 'path' ? (
        <div className='setting-path'>
          <input
            {...attributes}
            type='text'
            value={value || ''}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type='button'
            onClick={async () => {
              try {
                const result = await window.api.extensionChooseVaultPath(
                  extensionId,
                  setting.pathKind || 'file'
                );
                if (result) onChange(result);
              } catch (error) {
                onChange(value);
              }
            }}
          >
            Browse…
          </button>
        </div>
      ) : (
        <input
          {...attributes}
          type={
            setting.type === 'secret'
              ? 'password'
              : setting.type === 'boolean'
                ? 'checkbox'
                : setting.type === 'number'
                  ? 'number'
                  : 'text'
          }
          {...(setting.type === 'boolean' ? { checked: value } : { value })}
          min={setting.min}
          max={setting.max}
          maxLength={setting.maxLength ?? 1000}
          step='any'
          onChange={(event) =>
            onChange(setting.type === 'boolean' ? event.target.checked : event.target.value)
          }
        />
      )}
    </label>
  );
}
