export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import { RekognitionClient, IndexFacesCommand } from '@aws-sdk/client-rekognition'
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

async function indexFaceInBackground(
  buffer: Buffer,
  collectionId: string,
  publicId: string,
  photoId: string
) {
  try {
    const indexCommand = new IndexFacesCommand({
      CollectionId: collectionId,
      Image: { Bytes: buffer },
      ExternalImageId: publicId.replace(/\//g, '_'),
      DetectionAttributes: [],
    })
    const indexResult = await rekognition.send(indexCommand)
    const faceId = indexResult.FaceRecords?.[0]?.Face?.FaceId || null

    if (faceId) {
      await supabase
        .from('photos')
        .update({ rekognition_face_id: faceId })
        .eq('id', photoId)
      console.log('Face indexed successfully:', faceId)
    }
  } catch (err: any) {
    console.error('Background face index error:', err.message)
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('photos') as File[]
    const eventId = formData.get('eventId') as string

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const results = []

    for (const file of files) {
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Step 1 — Upload to Cloudinary
      const cloudinaryResult = await new Promise<any>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: `wedding-photos/${eventId}` },
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        ).end(buffer)
      })

      // Step 2 — Save to Supabase immediately without face ID
      const { data } = await supabase
        .from('photos')
        .insert({
          event_id: eventId,
          cloudinary_url: cloudinaryResult.secure_url,
          cloudinary_public_id: cloudinaryResult.public_id,
          rekognition_face_id: null,
        })
        .select()
        .single()

      results.push(data)

      // Step 3 — Index face in background (non-blocking)
      const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
      indexFaceInBackground(buffer, collectionId, cloudinaryResult.public_id, data.id)
    }

    // Return success immediately after Cloudinary upload
    return NextResponse.json({ success: true, photos: results })
  } catch (error: any) {
    console.error('Upload error:', error.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}