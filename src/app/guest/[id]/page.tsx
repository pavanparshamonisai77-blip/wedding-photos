'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import toast from 'react-hot-toast'
import { PhotoProvider, PhotoView } from 'react-photo-view'
import 'react-photo-view/dist/react-photo-view.css'

interface Photo {
  id: string
  cloudinary_url: string
  thumbnail_url: string
  web_url: string
  download_url: string
}

export default function GuestPage() {
  const { id } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scanning, setScanning] = useState(false)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState('')
  const [step, setStep] = useState<'camera' | 'results'>('camera')
  const [downloading, setDownloading] = useState(false)
  const [eventName, setEventName] = useState('')

  useEffect(() => {
    fetchEvent()
    startCamera()
    return () => stopCamera()
  }, [])

  async function fetchEvent() {
    const { data } = await supabase.from('events').select('name').eq('id', id).single()
    if (data) setEventName(data.name)
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      setError('Camera access denied. Please allow camera permission.')
    }
  }

  function stopCamera() {
    const stream = videoRef.current?.srcObject as MediaStream
    stream?.getTracks().forEach(track => track.stop())
  }

  async function captureAndScan() {
    if (!videoRef.current || !canvasRef.current) return
    setScanning(true)
    setError('')

    const canvas = canvasRef.current
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)

    canvas.toBlob(async (blob) => {
      if (!blob) return

      const formData = new FormData()
      formData.append('image', blob, 'face.jpg')
      formData.append('eventId', id as string)

      try {
        const res = await fetch('/api/face-match', { method: 'POST', body: formData })
        const data = await res.json()

        if (data.error) {
          setError(data.error === 'No face detected'
            ? 'No face detected. Please look directly at the camera.'
            : 'Something went wrong. Please try again.')
        } else if (data.photos.length === 0) {
          setError('No matching photos found for your face in this event.')
        } else {
          setPhotos(data.photos)
          setStep('results')
          stopCamera()
          toast.success(`Found ${data.photos.length} photos of you!`)
        }
      } catch (err) {
        setError('Network error. Please try again.')
      }
      setScanning(false)
    }, 'image/jpeg', 0.95)
  }

  async function trackDownload(photoId: string) {
    await supabase.from('photo_downloads').insert({ photo_id: photoId })
  }

  async function downloadSingle(photo: Photo) {
    try {
      const url = photo.download_url || photo.cloudinary_url
      const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
      const blob = await res.blob()
      saveAs(blob, `wedding-photo-${photo.id}.jpg`)
      await trackDownload(photo.id)
      toast.success('Photo downloaded!')
    } catch (err) {
      window.open(photo.cloudinary_url, '_blank')
      await trackDownload(photo.id)
    }
  }

  async function downloadAll() {
    setDownloading(true)
    const toastId = toast.loading('Preparing your photos...')
    try {
      const zip = new JSZip()
      await Promise.all(photos.map(async (photo, i) => {
        const url = photo.download_url || photo.cloudinary_url
        const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
        const blob = await res.blob()
        zip.file(`wedding-photo-${i + 1}.jpg`, blob)
        await trackDownload(photo.id)
      }))
      const content = await zip.generateAsync({ type: 'blob' })
      saveAs(content, 'my-wedding-photos.zip')
      toast.success('All photos downloaded!', { id: toastId })
    } catch (err) {
      toast.error('Download failed. Try individually.', { id: toastId })
    }
    setDownloading(false)
  }

  async function sharePhoto(photo: Photo) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Wedding Photo',
          text: 'Check out my wedding photo!',
          url: photo.cloudinary_url,
        })
      } catch (err) {
        // User cancelled share
      }
    } else {
      navigator.clipboard.writeText(photo.cloudinary_url)
      toast.success('Photo link copied!')
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4">
      <h1 className="text-2xl font-bold text-center mb-1">💍 {eventName}</h1>
      <p className="text-center text-gray-400 mb-6">Your Wedding Photos</p>

      {step === 'camera' && (
        <div className="max-w-md mx-auto">
          <div className="relative rounded-2xl overflow-hidden mb-6 bg-gray-900">
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
              <div className="w-[340px] h-[420px] rounded-full border-4 border-rose-500 opacity-90 animate-pulse" />
              <p className="text-white text-sm font-semibold bg-black bg-opacity-60 px-4 py-1 rounded-full">
                Position your face in the circle
              </p>
            </div>
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {error && (
            <p className="text-red-400 text-center mb-4 text-sm bg-red-950 rounded-xl p-3">{error}</p>
          )}

          <button
            onClick={captureAndScan}
            disabled={scanning}
            className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-gray-700 rounded-2xl py-4 font-semibold text-lg transition"
          >
            {scanning ? '🔍 Scanning your face...' : '📸 Find My Photos'}
          </button>

          <p className="text-center text-gray-500 text-sm mt-4">
            Look directly at the camera and tap the button
          </p>
        </div>
      )}

      {step === 'results' && (
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <p className="text-gray-400 font-semibold">{photos.length} photo{photos.length !== 1 ? 's' : ''} found</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { setStep('camera'); setPhotos([]); startCamera() }}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm transition"
              >
                Scan Again
              </button>
              <button
                onClick={downloadAll}
                disabled={downloading}
                className="bg-rose-600 hover:bg-rose-700 disabled:bg-gray-700 px-3 py-2 rounded-lg text-sm transition"
              >
                {downloading ? 'Downloading...' : '⬇ Download All'}
              </button>
            </div>
          </div>

          <PhotoProvider>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {photos.map(photo => (
                <div key={photo.id} className="rounded-xl overflow-hidden bg-gray-900">
                  <PhotoView src={photo.cloudinary_url}>
                    <img
                      src={photo.web_url || photo.cloudinary_url}
                      alt="Your wedding photo"
                      className="w-full h-48 object-cover cursor-pointer hover:opacity-90 transition"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </PhotoView>
                  <div className="flex gap-1 p-1">
                    <button
                      onClick={() => downloadSingle(photo)}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 py-2 text-xs font-semibold rounded-lg transition"
                    >
                      ⬇ Download
                    </button>
                    <button
                      onClick={() => sharePhoto(photo)}
                      className="bg-gray-700 hover:bg-gray-600 px-3 py-2 text-xs rounded-lg transition"
                    >
                      Share
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </PhotoProvider>
        </div>
      )}
    </main>
  )
}