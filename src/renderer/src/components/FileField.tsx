import { PathPicker } from './PathPicker';

type FileFieldProps = {
  label: string;
  hint: string;
  addLabel: string;
  value: string | undefined;
  onChange: (file: string | undefined) => void;
  onOpen?: () => void;
};

export function FileField({ label, hint, addLabel, value, onChange, onOpen }: FileFieldProps) {
  return (
    <div className="field-block">
      <h3>{label}</h3>
      <p className="hint">{hint}</p>
      {value ? (
        <p className="file-row">
          <span className="path">{value}</span>
          {onOpen && (
            <button className="quiet" onClick={onOpen}>
              Open file
            </button>
          )}
          <button className="quiet" onClick={() => onChange(undefined)}>
            Remove
          </button>
        </p>
      ) : (
        <PathPicker kind="file" label={label} browseLabel={addLabel} onSelect={onChange} />
      )}
    </div>
  );
}
