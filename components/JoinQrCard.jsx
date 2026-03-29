"use client";

import { QRCodeSVG } from "qrcode.react";

const cardStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "16px",
  alignItems: "center",
  marginTop: "16px",
  padding: "16px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  backgroundColor: "#fafafa"
};

const qrWrapperStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "180px",
  minHeight: "180px",
  padding: "12px",
  borderRadius: "8px",
  backgroundColor: "#fff",
  border: "1px solid #e5e5e5"
};

const urlStyle = {
  marginTop: "8px",
  fontSize: "14px",
  color: "#555",
  wordBreak: "break-all"
};

export default function JoinQrCard({
  url,
  title = "Scan to Join",
  helperText = "Players can scan this code to open the game on their phones."
}) {
  if (!url) {
    return null;
  }

  return (
    <div style={cardStyle}>
      <div style={{ flex: "1 1 240px" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <p style={{ marginTop: "8px", marginBottom: 0 }}>{helperText}</p>
        <div style={urlStyle}>{url}</div>
      </div>

      <div style={qrWrapperStyle}>
        <QRCodeSVG value={url} size={160} includeMargin level="M" />
      </div>
    </div>
  );
}
