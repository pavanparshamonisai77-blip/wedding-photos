'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { PhotoProvider, PhotoView } from 'react-photo-view'
import 'react-photo-view/dist/react-photo-view.css'

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
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, stage: '' })
  const [stats, setStats] = useState<Stats>({ totalPhotos: 0, totalScans: 0, totalDownloads: 0 })
  const [uploadSpeed, setUploadSpeed] = useState('')

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
    const total = files.length
    let uploaded = 0
    let failed = 0

    setUploadProgress({ current: 0, total, stage: 'Uploading photos...' })

    const batchSize = 5
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)

      await Promise.all(batch.map(async (file) => {
        try {
          const startTime = Date.now()

          const sigRes = await fetch('/api/sign-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: id }),
          })
          const { signature, timestamp, folder, cloudName, apiKey } = await sigRes.json()

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

          if (!cloudData.secure_url) { failed++; return }

          // Calculate upload speed
          const elapsed = (Date.now() - startTime) / 1000
          const speedMBps = (file.size / (1024 * 1024) / elapsed).toFixed(1)
          setUploadSpeed(`${speedMBps} MB/s`)

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
          setUploadProgress({ current: uploaded, total, stage: 'Uploading photos...' })
        } catch (err) {
          failed++
        }
      }))

      fetchPhotos()
      fetchStats()
    }

    // Auto reindex
    setUploadProgress({ current: uploaded, total, stage: 'Indexing faces...' })
    setUploadSpeed('')
    await fetch('/api/reindex-faces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })

    fetchPhotos()
    fetchStats()
    setUploading(false)
    setUploadProgress({ current: 0, total: 0, stage: '' })

    if (failed > 0) {
      toast.error(`${uploaded} uploaded, ${failed} failed`)
    } else {
      toast.success(`All ${uploaded} photos uploaded and faces indexed!`)
    }
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
    const toastId = toast.loading(`Deleting ${selected.length} photos...`)
    for (const photoId of selected) {
      const photo = photos.find(p => p.id === photoId)
      if (photo) await deletePhoto(photo.id, photo.cloudinary_public_id)
    }
    setSelected([])
    toast.success('Photos deleted!', { id: toastId })
  }

  async function deleteAll() {
    if (!confirm('Delete ALL photos?')) return
    const toastId = toast.loading('Deleting all photos...')
    for (const photo of photos) {
      await deletePhoto(photo.id, photo.cloudinary_public_id)
    }
    toast.success('All photos deleted!', { id: toastId })
  }

  async function reindexFaces() {
    const toastId = toast.loading('Reindexing faces...')
    const res = await fetch('/api/reindex-faces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })
    const data = await res.json()
    toast.success(data.message || 'Reindexing complete!', { id: toastId })
    fetchPhotos()
  }

  function toggleSelect(photoId: string) {
    setSelected(prev =>
      prev.includes(photoId) ? prev.filter(id => id !== photoId) : [...prev, photoId]
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-6">
        <h1 className="text-3xl font-bold">{event?.name}</h1>
        <p className="text-gray-400">{event?.date}</p>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Photos', value: stats.totalPhotos },
          { label: 'Scans', value: stats.totalScans },
          { label: 'Downloads', value: stats.totalDownloads },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-rose-500">{stat.value}</p>
            <p className="text-gray-400 text-sm mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* QR Code */}
      {event?.qr_code_url && (
        <div className="max-w-4xl mx-auto bg-gray-900 rounded-2xl p-5 mb-6 flex items-center gap-4 flex-wrap">
          <img src={event.qr_code_url} alt="QR Code" className="w-24 h-24 rounded-xl" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold mb-1">Guest QR Code</h2>
            <p className="text-gray-400 text-sm mb-3">Guests scan this to find their photos</p>
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
      <div className="max-w-4xl mx-auto mb-6">
        <label className={`block w-full rounded-2xl p-6 text-center transition ${uploading ? 'bg-gray-700 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700 cursor-pointer'}`}>
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={uploadPhotos}
            disabled={uploading}
          />
          {uploading ? (
            <div>
              <p className="font-semibold text-lg mb-1">{uploadProgress.stage}</p>
              <p className="text-sm text-gray-300 mb-1">
                {uploadProgress.current} / {uploadProgress.total} photos
                {uploadSpeed && ` • ${uploadSpeed}`}
              </p>
              <div className="w-full bg-gray-600 rounded-full h-3 mt-2">
                <div
                  className="bg-rose-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="font-semibold text-lg">📷 Click to Upload Photos</p>
          )}
        </label>
      </div>

      {/* Actions */}
      {photos.length > 0 && (
        <div className="max-w-4xl mx-auto flex gap-3 mb-6 flex-wrap">
          {selected.length > 0 && (
            <button
              onClick={deleteSelected}
              className="bg-red-700 hover:bg-red-800 px-4 py-2 rounded-lg text-sm transition"
            >
              Delete Selected ({selected.length})
            </button>
          )}
          <button onClick={deleteAll} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition">
            Delete All
          </button>
          <button onClick={reindexFaces} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition">
            🔄 Reindex Faces
          </button>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition">
              Clear Selection
            </button>
          )}
        </div>
      )}

      {/* Gallery */}
      <PhotoProvider>
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map(photo => (
            <div
              key={photo.id}
              className={`relative rounded-xl overflow-hidden border-2 transition ${selected.includes(photo.id) ? 'border-rose-500' : 'border-transparent'}`}
            >
              <PhotoView src={photo.cloudinary_url}>
                <img
                  src={photo.cloudinary_url}
                  alt="Wedding photo"
                  className="w-full h-40 object-cover cursor-pointer hover:opacity-90 transition"
                  loading="lazy"
                  onClick={() => toggleSelect(photo.id)}
                />
              </PhotoView>
              <button
                onClick={e => { e.stopPropagation(); deletePhoto(photo.id, photo.cloudinary_public_id) }}
                className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 rounded-full w-7 h-7 flex items-center justify-center text-xs"
              >
                ✕
              </button>
              {selected.includes(photo.id) && (
                <div className="absolute inset-0 bg-rose-500 bg-opacity-20 flex items-center justify-center pointer-events-none">
                  <span className="text-2xl">✓</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </PhotoProvider>
    </main>
  )
}