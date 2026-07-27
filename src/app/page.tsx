'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()

  useEffect(() => {
    fetchEvents()
  }, [])

  async function fetchEvents() {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setEvents(data)
  }

  async function createEvent() {
    if (!name || !date) return alert('Please enter event name and date')
    setLoading(true)

    const { data, error } = await supabase
      .from('events')
      .insert({ name, date })
      .select()
      .single()

    if (error) { alert('Error creating event'); setLoading(false); return }

    // Generate QR code URL pointing to guest page
    const guestUrl = `${window.location.origin}/guest/${data.id}`
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(guestUrl)}`

    await supabase
      .from('events')
      .update({ qr_code_url: qrUrl })
      .eq('id', data.id)

    setName('')
    setDate('')
    setLoading(false)
    fetchEvents()
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event and all its photos?')) return
    await supabase.from('events').delete().eq('id', id)
    fetchEvents()
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <h1 className="text-3xl font-bold text-center mb-8">💍 Wedding Photos</h1>

      {/* Create Event */}
      <div className="max-w-md mx-auto bg-gray-900 rounded-2xl p-6 mb-10">
        <h2 className="text-xl font-semibold mb-4">Create New Event</h2>
        <input
          className="w-full bg-gray-800 rounded-lg px-4 py-2 mb-3 outline-none"
          placeholder="Event name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          type="date"
          className="w-full bg-gray-800 rounded-lg px-4 py-2 mb-4 outline-none"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button
          onClick={createEvent}
          disabled={loading}
          className="w-full bg-rose-600 hover:bg-rose-700 rounded-lg py-2 font-semibold transition"
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
          <div key={event.id} className="bg-gray-900 rounded-2xl p-5 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">{event.name}</h3>
              <p className="text-gray-400 text-sm">{event.date}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push(`/event/${event.id}`)}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition"
              >
                Open
              </button>
              <button
                onClick={() => deleteEvent(event.id)}
                className="bg-red-700 hover:bg-red-800 px-4 py-2 rounded-lg text-sm transition"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}