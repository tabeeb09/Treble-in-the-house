export const metadata = {
  title: "LAN Lyric Imposter",
  description: "Minimal local network hidden-role lyric party game"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
          background:
            "radial-gradient(circle at top, #ffe8bf 0%, #f5d7b0 18%, #d8e6ff 58%, #f6f2ea 100%)",
          color: "#1d1b1a",
          minHeight: "100vh"
        }}
      >
        {children}
      </body>
    </html>
  );
}
