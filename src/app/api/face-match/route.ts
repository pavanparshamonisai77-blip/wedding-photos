import { NextRequest, NextResponse } from 'next/server'
import { RekognitionClient, SearchFacesByImageCommand } from '@aws-sdk/client-rekognition'
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { supabase } from '@/lib/supabase'

const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const sqs = new SQSClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File
    const eventId = formData.get('eventId') as string

    console.log('EventId:', eventId)
    console.log('SQS URL:', process.env.AWS_SQS_QUEUE_URL)
    console.log('AWS Region:', process.env.AWS_REGION)

    const bytes = await imageFile.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Push job to SQS
    try {
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.AWS_SQS_QUEUE_URL!,
        MessageBody: JSON.stringify({ eventId, timestamp: Date.now() }),
      }))
      console.log('SQS message sent successfully')
    } catch (sqsError: any) {
      console.error('SQS Error:', sqsError.message)
      // Continue even if SQS fails
    }

    // Search faces in Rekognition
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
    console.log('Collection ID:', collectionId)

    let matchedFaceIds: string[] = []

    try {
      const searchResult = await rekognition.send(new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: { Bytes: buffer },
        FaceMatchThreshold: 80,
        MaxFaces: 10,
      }))
      console.log('Face matches:', searchResult.FaceMatches?.length)
      matchedFaceIds = searchResult.FaceMatches?.map(
        match => match.Face?.FaceId!
      ).filter(Boolean) || []
    } catch (rekError: any) {
      console.error('Rekognition Error:', rekError.message)
      return NextResponse.json({ error: 'No face detected' }, { status: 400 })
    }

    console.log('Matched face IDs:', matchedFaceIds)

    // Get photos from Supabase
    const { data: photos, error: dbError } = await supabase
      .from('photos')
      .select('id, cloudinary_url, thumbnail_url, web_url, download_url')
      .eq('event_id', eventId)
      .in('rekognition_face_id', matchedFaceIds)

    if (dbError) {
      console.error('Supabase Error:', dbError.message)
    }

    console.log('Photos found:', photos?.length)

    // Track guest scan
    await supabase.from('guest_scans').insert({ event_id: eventId })

    return NextResponse.json({ success: true, photos: photos || [] })
  } catch (error: any) {
    console.error('Face match error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}