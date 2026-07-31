'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import Image from 'next/image'

interface Photo {
  id: string
  cloudinary_url: string
  cloudinary_public_id: string
  uploaded_at: string
}

interface Event {
  id: string
  name: string
  date: string
  qr_code_url: string
}

interface Stats {
  totalPhotos: number
  totalScans: number
  totalDownloads: number
}

export default function EventPage() {
  const { id } = useParams()
  const [event, setEvent] = useState<Event | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [stats, setStats] = useState<Stats>({ totalPhotos: 0, totalScans: 0, totalDownloads: 0 })

  useEffect(() => {
    fetchEvent()
    fetchPhotos()
    fetchStats()
    createCollection()
  }, [id])

  async function createCollection() {
    await fetch('/api/create-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })
  }

  async function fetchEvent() {
    const { data } = await supabase.from('events').select('*').eq('id', id).single()
    if (data) setEvent(data)
  }

  async function fetchPhotos() {
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('event_id', id)
      .order('uploaded_at', { ascending: false })
    if (data) setPhotos(data)
  }

  async function fetchStats() {
    const { count: totalPhotos } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id)

    const { count: totalScans } = await supabase
      .from('guest_scans')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id)

    const photoIds = (await supabase.from('photos').select('id').eq('event_id', id)).data?.map(p => p.id) || []

    let totalDownloads = 0
    if (photoIds.length > 0) {
      const { count } = await supabase
        .from('photo_downloads')
        .select('*', { count: 'exact', head: true })
        .in('photo_id', photoIds)
      totalDownloads = count || 0
    }

    setStats({ totalPhotos: totalPhotos || 0, totalScans: totalScans || 0, totalDownloads })
  }

  async function uploadPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return
    setUploading(true)

    const files = Array.from(e.target.files)
    let uploaded = 0

    for (const file of files) {
      try {
        // Step 1 — Get signature from our API
        const sigRes = await fetch('/api/sign-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: id }),
        })
        const { signature, timestamp, folder, cloudName, apiKey } = await sigRes.json()

        // Step 2 — Upload directly to Cloudinary (bypasses Vercel)
        const formData = new FormData()
        formData.append('file', file)
        formData.append('signature', signature)
        formData.append('timestamp', timestamp)
        formData.append('folder', folder)
        formData.append('api_key', apiKey)

        const cloudRes = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          { method: 'POST', body: formData }
        )
        const cloudData = await cloudRes.json()

        if (!cloudData.secure_url) {
          console.error('Cloudinary upload failed:', cloudData)
          continue
        }

        // Step 3 — Save to Supabase + index face in Rekognition
        await fetch('/api/save-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: id,
            cloudinaryUrl: cloudData.secure_url,
            publicId: cloudData.public_id,
          }),
        })

        uploaded++
        fetchPhotos()
        fetchStats()
      } catch (err) {
        console.error('Upload error:', err)
      }
    }

    setUploading(false)
    alert(`${uploaded}/${files.length} photos uploaded successfully!`)
  }

  async function deletePhoto(photoId: string, publicId: string) {
    await fetch('/api/delete-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, publicId }),
    })
    fetchPhotos()
    fetchStats()
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.length} photos?`)) return
    for (const photoId of selected) {
      const photo = photos.find(p => p.id === photoId)
      if (photo) await deletePhoto(photo.id, photo.cloudinary_public_id)
    }
    setSelected([])
  }

  async function deleteAll() {
    if (!confirm('Delete ALL photos?')) return
    for (const photo of photos) {
      await deletePhoto(photo.id, photo.cloudinary_public_id)
    }
  }

  function toggleSelect(photoId: string) {
    setSelected(prev =>
      prev.includes(photoId) ? prev.filter(id => id !== photoId) : [...prev, photoId]
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-8">
        <h1 className="text-3xl font-bold">{event?.name}</h1>
        <p className="text-gray-400">{event?.date}</p>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Photos Uploaded', value: stats.totalPhotos },
          { label: 'Guests Scanned', value: stats.totalScans },
          { label: 'Total Downloads', value: stats.totalDownloads },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-rose-500">{stat.value}</p>
            <p className="text-gray-400 text-sm mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* QR Code */}
      {event?.qr_code_url && (
        <div className="max-w-4xl mx-auto bg-gray-900 rounded-2xl p-6 mb-8 flex items-center gap-6">
          <img src={event.qr_code_url} alt="QR Code" className="w-32 h-32" />
          <div>
            <h2 className="text-lg font-semibold mb-2">Guest QR Code</h2>
            <p className="text-gray-400 text-sm mb-3">Guests scan this to view their photos</p>
            
              <button
  onClick={() => window.open(event.qr_code_url, '_blank')}
  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition"
>
  Download QR
</button>
          </div>
        </div>
      )}

      {/* Upload */}
      <div className="max-w-4xl mx-auto mb-8">
        <label className="block w-full bg-rose-600 hover:bg-rose-700 rounded-2xl p-6 text-center cursor-pointer transition">
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={uploadPhotos}
          />
          {uploading ? '⏳ Uploading directly to cloud...' : '📷 Click to Upload Photos (No size limit)'}
        </label>
      </div>

      {/* Actions */}
      {photos.length > 0 && (
        <div className="max-w-4xl mx-auto flex gap-3 mb-6">
          {selected.length > 0 && (
            <button
              onClick={deleteSelected}
              className="bg-red-700 hover:bg-red-800 px-4 py-2 rounded-lg text-sm transition"
            >
              Delete Selected ({selected.length})
            </button>
          )}
          <button
            onClick={deleteAll}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition"
          >
            Delete All
          </button>
        </div>
      )}

      {/* Gallery */}
      <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map(photo => (
          <div
            key={photo.id}
            className={`relative rounded-xl overflow-hidden cursor-pointer border-2 transition ${
              selected.includes(photo.id) ? 'border-rose-500' : 'border-transparent'
            }`}
            onClick={() => toggleSelect(photo.id)}
          >
            <img
              src={photo.cloudinary_url}
              alt="Wedding photo"
              className="w-full h-40 object-cover"
            />
            <button
              onClick={e => { e.stopPropagation(); deletePhoto(photo.id, photo.cloudinary_public_id) }}
              className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 rounded-full w-7 h-7 flex items-center justify-center text-xs"
            >
              ✕
            </button>
            {selected.includes(photo.id) && (
              <div className="absolute inset-0 bg-rose-500 bg-opacity-20 flex items-center justify-center">
                <span className="text-2xl">✓</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}