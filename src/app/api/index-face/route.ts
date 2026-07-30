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
    const { photoId, cloudinaryUrl, eventId, publicId } = await req.json()

    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`

    // Fetch image from Cloudinary
    const imageRes = await fetch(cloudinaryUrl)
    const imageBuffer = await imageRes.arrayBuffer()
    const buffer = Buffer.from(imageBuffer)

    // Index face in Rekognition
    const indexCommand = new IndexFacesCommand({
      CollectionId: collectionId,
      Image: { Bytes: buffer },
      ExternalImageId: publicId.replace(/\//g, '_'),
      DetectionAttributes: [],
    })

    const indexResult = await rekognition.send(indexCommand)
    const faceId = indexResult.FaceRecords?.[0]?.Face?.FaceId || null

    console.log('Face indexed:', faceId)

    // Update Supabase with face ID
    if (faceId) {
      await supabase
        .from('photos')
        .update({ rekognition_face_id: faceId })
        .eq('id', photoId)
    }

    return NextResponse.json({ success: true, faceId })
  } catch (error: any) {
    console.error('Index face error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}