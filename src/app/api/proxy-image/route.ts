import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'No URL' }, { status: 400 })

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'image/jpeg,image/png,image/*',
      }
    })

    if (!res.ok) throw new Error('Failed to fetch image')

    const blob = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') || 'image/jpeg'

    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="wedding-photo.jpg"',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}