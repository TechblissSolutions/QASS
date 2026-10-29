/**
 * Decorative 3D scene for the sign-in / sign-up pages (markup only; motion lives in
 * app/futuristic.css). Sits behind the card, ignores the pointer, hidden from screen readers.
 */
export default function AuthScene() {
  return (
    <div className="fx-auth-scene" aria-hidden="true">
      <div className="fx-auth-layer fx-auth-layer-far">
        <i className="fx-orb fx-orb-a" />
        <i className="fx-orb fx-orb-b" />
        <i className="fx-orb fx-orb-c" />
        <i className="fx-ring fx-ring-a" />
      </div>
      <div className="fx-auth-layer fx-auth-layer-near">
        <i className="fx-ring fx-ring-b" />
        <div className="fx-cube">
          <i /><i /><i /><i /><i /><i />
        </div>
        {Array.from({ length: 9 }, (_, n) => (
          <b key={n} className="fx-dot" style={{ ['--n' as string]: n }} />
        ))}
      </div>
    </div>
  );
}
