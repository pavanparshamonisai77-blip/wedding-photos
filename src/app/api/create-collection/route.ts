import { NextRequest, NextResponse } from 'next/server'
import { RekognitionClient, CreateCollectionCommand } from '@aws-sdk/client-rekognition'

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
    const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`

    const command = new CreateCollectionCommand({ CollectionId: collectionId })
    await rekognition.send(command)

    return NextResponse.json({ success: true, collectionId })
  } catch (error: any) {
    if (error.name === 'ResourceAlreadyExistsException') {
      return NextResponse.json({ success: true, message: 'Collection already exists' })
    }
    return NextResponse.json({ error: 'Failed to create collection' }, { status: 500 })
  }
}