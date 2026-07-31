import sharp from 'sharp'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { RekognitionClient, IndexFacesCommand } from '@aws-sdk/client-rekognition'
import { supabase } from '@/lib/supabase'

const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

async function indexFaceWithRetry(
  buffer: Buffer,
  collectionId: string,
  publicId: string,
  retries = 3
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const indexResult = await rekognition.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: buffer },
        ExternalImageId: publicId.replace(/\//g, '_'),
        DetectionAttributes: [],
      }))
      const faceId = indexResult.FaceRecords?.[0]?.Face?.FaceId || null
      if (faceId) return faceId
    } catch (err: any) {
      console.log(`Attempt ${attempt} failed:`, err.message)
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const { eventId } = await req.json()

    const { data: photos } = await supabase
      .from('photos')
      .select('id, cloudinary_url, cloudinary_public_id')
      .eq('event_id', eventId)
      .is('rekognition_face_id', null)

    if (!photos || photos.length === 0) {
      return NextResponse.json({ success: true, message: 'All photos already indexed' })
    }

    console.log(`Reindexing ${photos.length} photos`)
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
    let indexed = 0

    for (const photo of photos) {
      try {
        const imageRes = await fetch(photo.cloudinary_url)
const imageBuffer = await imageRes.arrayBuffer()
// Resize to under 5MB for Rekognition
const buffer = await sharp(Buffer.from(imageBuffer))
  .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()

        const faceId = await indexFaceWithRetry(
          buffer,
          collectionId,
          photo.cloudinary_public_id
        )

        if (faceId) {
          await supabase
            .from('photos')
            .update({ rekognition_face_id: faceId })
            .eq('id', photo.id)
          indexed++
        }
      } catch (err: any) {
        console.log(`Failed to reindex photo ${photo.id}:`, err.message)
      }
    }

    return NextResponse.json({
      success: true,
      message: `${indexed} out of ${photos.length} photos indexed successfully`
    })
  } catch (error: any) {
    console.error('Reindex error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}