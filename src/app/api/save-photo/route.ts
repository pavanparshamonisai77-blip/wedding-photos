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

    // Fetch image from Cloudinary for Rekognition
    const imageRes = await fetch(cloudinaryUrl)
    const imageBuffer = await imageRes.arrayBuffer()
    const buffer = Buffer.from(imageBuffer)

    // Index face in Rekognition
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
    try {
      const indexResult = await rekognition.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: buffer },
        ExternalImageId: publicId.replace(/\//g, '_'),
        DetectionAttributes: [],
      }))

      const faceId = indexResult.FaceRecords?.[0]?.Face?.FaceId || null
      console.log('Face indexed:', faceId)

      if (faceId) {
        await supabase
          .from('photos')
          .update({ rekognition_face_id: faceId })
          .eq('id', photo.id)
      }
    } catch (rekErr: any) {
      console.log('No face detected:', rekErr.message)
    }

    return NextResponse.json({ success: true, photo })
  } catch (error: any) {
    console.error('Save photo error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}