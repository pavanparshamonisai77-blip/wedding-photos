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

    const bytes = await imageFile.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Push job to SQS
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.AWS_SQS_QUEUE_URL!,
      MessageBody: JSON.stringify({ eventId, timestamp: Date.now() }),
    }))

    // Search faces in Rekognition
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`

    let matchedFaceIds: string[] = []

    try {
      const searchResult = await rekognition.send(new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: { Bytes: buffer },
        FaceMatchThreshold: 80,
        MaxFaces: 10,
      }))

      matchedFaceIds = searchResult.FaceMatches?.map(
        match => match.Face?.FaceId!
      ).filter(Boolean) || []
    } catch (err) {
      return NextResponse.json({ error: 'No face detected' }, { status: 400 })
    }

    // Get photos from Supabase matching face IDs
    const { data: photos } = await supabase
      .from('photos')
      .select('*')
      .eq('event_id', eventId)
      .in('rekognition_face_id', matchedFaceIds)

    // Track guest scan
    await supabase.from('guest_scans').insert({ event_id: eventId })

    // Consume SQS message
    const messages = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: process.env.AWS_SQS_QUEUE_URL!,
      MaxNumberOfMessages: 1,
    }))

    if (messages.Messages?.[0]?.ReceiptHandle) {
      await sqs.send(new DeleteMessageCommand({
        QueueUrl: process.env.AWS_SQS_QUEUE_URL!,
        ReceiptHandle: messages.Messages[0].ReceiptHandle,
      }))
    }

    return NextResponse.json({ success: true, photos: photos || [] })
  } catch (error) {
    console.error('Face match error:', error)
    return NextResponse.json({ error: 'Face match failed' }, { status: 500 })
  }
}