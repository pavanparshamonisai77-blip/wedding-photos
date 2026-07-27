import { NextRequest, NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import { RekognitionClient, DeleteCollectionCommand } from '@aws-sdk/client-rekognition'
import { supabase } from '@/lib/supabase'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
})

const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export async function POST(req: NextRequest) {
  try {
    const { eventId } = await req.json()

    // Step 1 — Get all photos for this event
    const { data: photos } = await supabase
      .from('photos')
      .select('cloudinary_public_id')
      .eq('event_id', eventId)

    // Step 2 — Delete all photos from Cloudinary
    if (photos && photos.length > 0) {
      const publicIds = photos.map(p => p.cloudinary_public_id)
      await cloudinary.api.delete_resources(publicIds)

      // Delete the event folder in Cloudinary
      await cloudinary.api.delete_folder(`wedding-photos/${eventId}`)
    }

    // Step 3 — Delete Rekognition collection
    try {
      const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
      await rekognition.send(new DeleteCollectionCommand({
        CollectionId: collectionId
      }))
    } catch (err) {
      console.log('Rekognition collection already deleted or not found')
    }

    // Step 4 — Delete event from Supabase (cascade deletes photos, scans, downloads)
    await supabase.from('events').delete().eq('id', eventId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete event error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}