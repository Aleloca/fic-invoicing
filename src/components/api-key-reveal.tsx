export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  return (
    <div className="notice">
      <p>
        <strong>Copy this API key now.</strong> It is stored hashed and will not be shown again.
      </p>
      <p className="secret">{apiKey}</p>
    </div>
  );
}
