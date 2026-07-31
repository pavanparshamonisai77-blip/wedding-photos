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

function getResizedCloudinaryUrl(url: string): string {
  // Insert transformation to resize to max 1920px and convert to jpg
  return url.replace('/upload/', '/upload/w_1920,h_1920,c_limit,f_jpg,q_85/')
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.arrayBuffer()
      return Buffer.from(data)
    } catch (err: any) {
      console.log(`Fetch attempt ${attempt} failed:`, err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
    }
  }
  return null
}

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
      console.log(`Rekognition attempt ${attempt} failed:`, err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const { eventId, cloudinaryUrl, publicId } = await req.json()

    // Save to Supabase first
    const { data: photo } = await supabase
      .from('photos')
      .insert({
        event_id: eventId,
        cloudinary_url: cloudinaryUrl,
        cloudinary_public_id: publicId,
        rekognition_face_id: null,
      })
      .select()
      .single()

    // Use Cloudinary URL transformation to get resized image under 5MB
    const resizedUrl = getResizedCloudinaryUrl(cloudinaryUrl)
    console.log('Fetching resized URL:', resizedUrl)

    const buffer = await fetchImageBuffer(resizedUrl)
    if (!buffer) {
      console.error('Failed to fetch image')
      return NextResponse.json({ success: true, photo, faceIndexed: false })
    }

    console.log('Image size:', buffer.length)

    // Index face in Rekognition
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
    const faceId = await indexFaceWithRetry(buffer, collectionId, publicId)

    if (faceId) {
      await supabase
        .from('photos')
        .update({ rekognition_face_id: faceId })
        .eq('id', photo.id)
      console.log('Face indexed:', faceId)
    } else {
      console.log('No face detected')
    }

    return NextResponse.json({ success: true, photo, faceIndexed: !!faceId })
  } catch (error: any) {
    console.error('Save photo error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}