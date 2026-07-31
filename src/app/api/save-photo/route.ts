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
      if (faceId) {
        console.log(`Face indexed on attempt ${attempt}:`, faceId)
        return faceId
      }
    } catch (err: any) {
      console.log(`Attempt ${attempt} failed:`, err.message)
      if (attempt < retries) {
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
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

    // Fetch image from Cloudinary with retry
    // Fetch image from Cloudinary with retry
      let buffer: Buffer | null = null
        for (let attempt = 1; attempt <= 3; attempt++) {
       try {
    const imageRes = await fetch(cloudinaryUrl)
if (!imageRes.ok) throw new Error('Failed to fetch image')
const blob = await imageRes.blob()
const arrayBuffer = await blob.arrayBuffer()
const rawBuffer = Buffer.allocUnsafe(arrayBuffer.byteLength)
const view = new Uint8Array(arrayBuffer)
for (let i = 0; i < view.length; i++) rawBuffer[i] = view[i]
console.log('Raw image size:', rawBuffer.length)
buffer = await sharp(rawBuffer)
  .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()
console.log('Compressed size:', buffer.length)
    break
  } catch (err: any) {
    console.log(`Image fetch attempt ${attempt} failed:`, err.message)
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

    if (!buffer) {
      console.error('Failed to fetch image after 3 attempts')
      return NextResponse.json({ success: true, photo, faceIndexed: false })
    }

    // Index face with retry
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
    const faceId = await indexFaceWithRetry(buffer, collectionId, publicId)

    if (faceId) {
      await supabase
        .from('photos')
        .update({ rekognition_face_id: faceId })
        .eq('id', photo.id)
    } else {
      console.log('No face detected after 3 attempts — will need reindex')
    }

    return NextResponse.json({ 
      success: true, 
      photo,
      faceIndexed: !!faceId 
    })
  } catch (error: any) {
    console.error('Save photo error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}