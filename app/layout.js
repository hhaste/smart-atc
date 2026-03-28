import "./globals.css"

export const metadata = {
  title: "AI-R | Michigan Airspace",
  description: "Next.js port of the Michigan Thumb live air traffic viewer."
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
