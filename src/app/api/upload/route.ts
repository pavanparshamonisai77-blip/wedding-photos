import { NextRequest, NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import { RekognitionClient, IndexFacesCommand } from '@aws-sdk/client-rekognition'
import { supabase } from '@/lib/supabase'
import sharp from 'sharp'

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

async function uploadToCloudinary(buffer: Buffer, folder: string, filename: string): Promise<any> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: 'image',
        overwrite: true,
      },
      (error, result) => {
        if (error) reject(error)
        else resolve(result)
      }
    ).end(buffer)
  })
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
      const originalBuffer = Buffer.from(bytes)
      const filename = `photo_${Date.now()}`
      const baseFolder = `wedding-photos/${eventId}`

      // Compress into 3 versions using sharp
      // Thumbnail — for gallery preview grid
      const thumbnailBuffer = await sharp(originalBuffer)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 80 })
        .toBuffer()

      // Web version — for full screen view on guest page
      const webBuffer = await sharp(originalBuffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()

      // Download version — high quality for guest download
      const downloadBuffer = await sharp(originalBuffer)
        .resize(4000, 4000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, progressive: true })
        .toBuffer()

      // Upload all 3 versions to Cloudinary simultaneously
      const [thumbnailResult, webResult, downloadResult] = await Promise.all([
        uploadToCloudinary(thumbnailBuffer, `${baseFolder}/thumbnails`, `${filename}_thumb`),
        uploadToCloudinary(webBuffer, `${baseFolder}/web`, `${filename}_web`),
        uploadToCloudinary(downloadBuffer, `${baseFolder}/downloads`, `${filename}_download`),
      ])

      // Index faces in Rekognition using web version
      let faceId = null
      try {
        const collectionId = `${process.env.AWS_REKOGNITION_COLLECTION_PREFIX}-${eventId}`
        const indexCommand = new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: webBuffer },
          ExternalImageId: webResult.public_id.replace(/\//g, '_'),
          DetectionAttributes: [],
        })
        const indexResult = await rekognition.send(indexCommand)
        faceId = indexResult.FaceRecords?.[0]?.Face?.FaceId || null
      } catch (err) {
        console.log('No face detected in photo')
      }

      // Save all 3 URLs to Supabase
      const { data } = await supabase
        .from('photos')
        .insert({
          event_id: eventId,
          cloudinary_url: webResult.secure_url,
          cloudinary_public_id: webResult.public_id,
          thumbnail_url: thumbnailResult.secure_url,
          web_url: webResult.secure_url,
          download_url: downloadResult.secure_url,
          rekognition_face_id: faceId,
        })
        .select()
        .single()

      results.push(data)
    }

    return NextResponse.json({ success: true, photos: results })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}