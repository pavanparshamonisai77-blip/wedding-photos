'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

interface Event {
  id: string
  name: string
  date: string
  qr_code_url: string
  created_at: string
}

export default function Home() {
  const [events, setEvents] = useState<Event[]>([])
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrPreview, setQrPreview] = useState<Event | null>(null)
  const router = useRouter()

  useEffect(() => { fetchEvents() }, [])

  async function fetchEvents() {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setEvents(data)
  }

  async function createEvent() {
    if (!name || !date) return toast.error('Please enter event name and date')
    setLoading(true)

    const { data, error } = await supabase
      .from('events')
      .insert({ name, date })
      .select()
      .single()

    if (error) {
      toast.error('Error creating event')
      setLoading(false)
      return
    }

    const guestUrl = `${window.location.origin}/guest/${data.id}`
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(guestUrl)}`

    await supabase.from('events').update({ qr_code_url: qrUrl }).eq('id', data.id)

    setName('')
    setDate('')
    setLoading(false)
    toast.success('Event created successfully!')
    fetchEvents()
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event and all its photos?')) return
    const toastId = toast.loading('Deleting event...')

    const res = await fetch('/api/delete-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })
    const data = await res.json()

    if (data.success) {
      toast.success('Event deleted!', { id: toastId })
      fetchEvents()
    } else {
      toast.error('Delete failed', { id: toastId })
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      <h1 className="text-3xl font-bold text-center mb-8">💍 Wedding Photos</h1>

      {/* Create Event */}
      <div className="max-w-md mx-auto bg-gray-900 rounded-2xl p-6 mb-10">
        <h2 className="text-xl font-semibold mb-4">Create New Event</h2>
        <input
          className="w-full bg-gray-800 rounded-lg px-4 py-3 mb-3 outline-none focus:ring-2 focus:ring-rose-500"
          placeholder="Event name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          type="date"
          className="w-full bg-gray-800 rounded-lg px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-rose-500"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button
          onClick={createEvent}
          disabled={loading}
          className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-gray-700 rounded-lg py-3 font-semibold transition"
        >
          {loading ? 'Creating...' : 'Create Event'}
        </button>
      </div>

      {/* Events List */}
      <div className="max-w-2xl mx-auto grid gap-4">
        {events.length === 0 && (
          <p className="text-center text-gray-500">No events yet. Create one above.</p>
        )}
        {events.map(event => (
          <div key={event.id} className="bg-gray-900 rounded-2xl p-5">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-semibold">{event.name}</h3>
                <p className="text-gray-400 text-sm">{event.date}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setQrPreview(event)}
                  className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm transition"
                >
                  🔲 QR Code
                </button>
                <button
                  onClick={() => router.push(`/event/${event.id}`)}
                  className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg text-sm transition"
                >
                  Open
                </button>
                <button
                  onClick={() => deleteEvent(event.id)}
                  className="bg-red-700 hover:bg-red-800 px-3 py-2 rounded-lg text-sm transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* QR Preview Modal */}
      {qrPreview && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={() => setQrPreview(null)}
        >
          <div
            className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full text-center"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-2">{qrPreview.name}</h3>
            <p className="text-gray-400 text-sm mb-4">Scan to view photos</p>
            <img
              src={qrPreview.qr_code_url}
              alt="QR Code"
              className="w-64 h-64 mx-auto mb-4 rounded-xl"
            />
            <div className="flex gap-3">
              <button
                onClick={() => window.open(qrPreview.qr_code_url, '_blank')}
                className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm transition"
              >
                Download QR
              </button>
              <button
                onClick={() => setQrPreview(null)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 py-2 rounded-lg text-sm transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}