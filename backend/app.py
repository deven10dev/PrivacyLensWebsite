from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import shutil
import os
import uuid
import time
import asyncio
from pathlib import Path
import cv2
import numpy as np
import io
import tempfile
import json
import logging
from datetime import datetime, timedelta
import base64

# Import the face anonymization libraries
from centerface import CenterFace
import deface

# Create FastAPI app
app = FastAPI(
    title="Privacy Lens API",
    description="API for anonymizing faces in videos and images",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("api.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("privacy-lens-api")

# Create temp directory for uploads and processed files
UPLOAD_DIR = Path("./uploads")
PROCESSED_DIR = Path("./processed")
UPLOAD_DIR.mkdir(exist_ok=True)
PROCESSED_DIR.mkdir(exist_ok=True)

# Create a CenterFace detector instance
centerface = CenterFace()

# Define models
class AnonymizationOptions(BaseModel):
    method: str = "blur"
    threshold: float = 0.2
    maskScale: float = 1.3
    blurIntensity: int = 5
    mosaicSize: int = 20
    ellipse: bool = True
    drawScores: bool = False
    scale: Optional[str] = None
    keepAudio: bool = True

class ProcessingJob(BaseModel):
    id: str
    filename: str
    status: str
    progress: float = 0
    created: datetime
    options: AnonymizationOptions
    output_file: Optional[str] = None
    preview_file: Optional[str] = None
    error: Optional[str] = None

# In-memory job storage (in a production app, use a database)
active_jobs = {}

def cleanup_old_files():
    """Remove files older than 24 hours"""
    now = datetime.now()
    # Cleanup uploads
    for file_path in UPLOAD_DIR.glob("*"):
        if file_path.is_file():
            mod_time = datetime.fromtimestamp(file_path.stat().st_mtime)
            if now - mod_time > timedelta(hours=24):
                file_path.unlink()
                logger.info(f"Removed old upload: {file_path}")
    
    # Cleanup processed files
    for file_path in PROCESSED_DIR.glob("*"):
        if file_path.is_file():
            mod_time = datetime.fromtimestamp(file_path.stat().st_mtime)
            if now - mod_time > timedelta(hours=24):
                file_path.unlink()
                logger.info(f"Removed old processed file: {file_path}")

@app.on_event("startup")
async def startup_event():
    """Run cleanup on startup"""
    cleanup_old_files()

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "ok", "message": "Privacy Lens API is running"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file for processing"""
    # Generate a unique ID for the file
    file_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1]
    
    # Create a unique filename
    unique_filename = f"{file_id}{file_extension}"
    file_path = UPLOAD_DIR / unique_filename
    
    # Save the uploaded file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    logger.info(f"Uploaded file: {file.filename} -> {file_path}")
    
    return {
        "id": file_id,
        "filename": file.filename,
        "stored_filename": unique_filename
    }

@app.post("/api/process/image")
async def process_image(
    background_tasks: BackgroundTasks,
    file_id: str = Form(...),
    filename: str = Form(...),
    options_json: str = Form(...)
):
    """Process an uploaded image with face anonymization"""
    options = AnonymizationOptions.parse_raw(options_json)
    
    # Generate job ID
    job_id = str(uuid.uuid4())
    
    # Find the uploaded file
    file_extension = os.path.splitext(filename)[1]
    input_path = UPLOAD_DIR / f"{file_id}{file_extension}"
    
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    
    # Create output path
    output_filename = f"{job_id}_anonymized{file_extension}"
    output_path = PROCESSED_DIR / output_filename
    
    # Create and store job info
    job = ProcessingJob(
        id=job_id,
        filename=filename,
        status="queued",
        created=datetime.now(),
        options=options,
        output_file=str(output_path)
    )
    active_jobs[job_id] = job
    
    # Start background processing task
    background_tasks.add_task(
        process_image_task,
        job_id=job_id,
        input_path=str(input_path),
        output_path=str(output_path),
        options=options
    )
    
    return {"job_id": job_id}

async def process_image_task(job_id: str, input_path: str, output_path: str, options: AnonymizationOptions):
    """Background task to process an image"""
    job = active_jobs[job_id]
    job.status = "processing"
    
    try:
        # Read the image
        img = cv2.imread(input_path)
        if img is None:
            raise ValueError(f"Could not read image: {input_path}")
        
        # Configure options
        threshold = options.threshold
        mask_scale = options.maskScale
        replacewith = options.method
        ellipse = options.ellipse
        draw_scores = options.drawScores
        mosaicsize = options.mosaicSize
        blur_intensity = options.blurIntensity
        
        # Prepare scale parameter
        scale = None
        if options.scale and options.scale != "None":
            scale_parts = options.scale.split('x')
            if len(scale_parts) == 2:
                try:
                    scale = (int(scale_parts[0]), int(scale_parts[1]))
                except ValueError:
                    scale = None
        
        # Create CenterFace instance with scale
        detector = CenterFace(in_shape=scale)
            
        # Detect faces
        dets, _ = detector(img, threshold=threshold)
        
        # Anonymize faces
        deface.anonymize_frame(
            dets, img, mask_scale=mask_scale,
            replacewith=replacewith, ellipse=ellipse, 
            draw_scores=draw_scores, replaceimg=None,
            mosaicsize=mosaicsize,
            blur_intensity=blur_intensity
        )
        
        # Save the processed image
        cv2.imwrite(output_path, img)
        
        # Create a small preview image
        preview_filename = f"{job_id}_preview.jpg"
        preview_path = PROCESSED_DIR / preview_filename
        
        # Resize for preview
        height, width = img.shape[:2]
        max_size = 800  # Max dimension for preview
        
        if height > width:
            new_height = max_size
            new_width = int(width * (max_size / height))
        else:
            new_width = max_size
            new_height = int(height * (max_size / width))
        
        preview_img = cv2.resize(img, (new_width, new_height))
        cv2.imwrite(str(preview_path), preview_img)
        
        # Update job status
        job.status = "completed"
        job.progress = 100
        job.preview_file = preview_filename
        
        logger.info(f"Image processing completed: {job_id}")
    
    except Exception as e:
        logger.error(f"Error processing image {job_id}: {str(e)}")
        job.status = "failed"
        job.error = str(e)

@app.post("/api/process/video")
async def process_video(
    background_tasks: BackgroundTasks,
    file_id: str = Form(...),
    filename: str = Form(...),
    options_json: str = Form(...)
):
    """Process an uploaded video with face anonymization"""
    options = AnonymizationOptions.parse_raw(options_json)
    
    # Generate job ID
    job_id = str(uuid.uuid4())
    
    # Find the uploaded file
    file_extension = os.path.splitext(filename)[1]
    input_path = UPLOAD_DIR / f"{file_id}{file_extension}"
    
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    
    # Create output path
    output_filename = f"{job_id}_anonymized{file_extension}"
    output_path = PROCESSED_DIR / output_filename
    
    # Create preview path
    preview_filename = f"{job_id}_preview.jpg"
    preview_path = PROCESSED_DIR / preview_filename
    
    # Create and store job info
    job = ProcessingJob(
        id=job_id,
        filename=filename,
        status="queued",
        created=datetime.now(),
        options=options,
        output_file=output_filename
    )
    active_jobs[job_id] = job
    
    # Start background processing task
    background_tasks.add_task(
        process_video_task,
        job_id=job_id,
        input_path=str(input_path),
        output_path=str(output_path),
        preview_path=str(preview_path),
        options=options
    )
    
    return {"job_id": job_id}

async def process_video_task(job_id: str, input_path: str, output_path: str, preview_path: str, options: AnonymizationOptions):
    """Background task to process a video"""
    job = active_jobs[job_id]
    job.status = "processing"
    
    try:
        import imageio
        import imageio.plugins.ffmpeg
        
        # Prepare scale parameter
        scale = None
        if options.scale and options.scale != "None":
            scale_parts = options.scale.split('x')
            if len(scale_parts) == 2:
                try:
                    scale = (int(scale_parts[0]), int(scale_parts[1]))
                except ValueError:
                    scale = None
        
        # Create CenterFace detector
        detector = CenterFace(in_shape=scale)
        
        # Open video reader
        reader = imageio.get_reader(input_path)
        meta = reader.get_meta_data()
        total_frames = reader.count_frames()
        
        # Configure options for anonymization
        threshold = options.threshold
        mask_scale = options.maskScale
        replacewith = options.method
        ellipse = options.ellipse
        draw_scores = options.drawScores
        mosaicsize = options.mosaicSize
        blur_intensity = options.blurIntensity
        
        # Configure ffmpeg options
        ffmpeg_config = {"codec": "libx264"}
        
        # Handle audio copying if requested
        if options.keepAudio and meta.get('audio_codec'):
            ffmpeg_config["audio_path"] = input_path
            ffmpeg_config["audio_codec"] = "copy"
        
        # Set fps from source video
        ffmpeg_config.setdefault('fps', meta.get('fps', 30))
        
        # Initialize video writer
        writer = imageio.get_writer(
            output_path, 
            format='FFMPEG', 
            mode='I', 
            **ffmpeg_config
        )
        
        # Process frames
        preview_saved = False
        for i, frame in enumerate(reader):
            # Update progress every 10 frames
            if i % 10 == 0:
                progress = min(int((i / total_frames) * 100), 99)
                job.progress = progress
                
                # Log progress occasionally
                if i % 100 == 0:
                    logger.info(f"Processing video {job_id}: {progress}% ({i}/{total_frames})")
            
            # Detect faces
            dets, _ = detector(frame, threshold=threshold)
            
            # Anonymize faces
            deface.anonymize_frame(
                dets, frame, mask_scale=mask_scale,
                replacewith=replacewith, ellipse=ellipse, 
                draw_scores=draw_scores, replaceimg=None,
                mosaicsize=mosaicsize,
                blur_intensity=blur_intensity
            )
            
            # Write the processed frame
            writer.append_data(frame)
            
            # Save a preview image from an early frame with faces
            if not preview_saved and len(dets) > 0 and i > min(15, total_frames // 10):
                # Create a preview image
                preview_img = frame.copy()
                
                # Resize for preview if needed
                height, width = preview_img.shape[:2]
                max_size = 800  # Max dimension for preview
                
                if height > width and height > max_size:
                    new_height = max_size
                    new_width = int(width * (max_size / height))
                    preview_img = cv2.resize(preview_img, (new_width, new_height))
                elif width > height and width > max_size:
                    new_width = max_size
                    new_height = int(height * (max_size / width))
                    preview_img = cv2.resize(preview_img, (new_width, new_height))
                
                # Save preview image
                if preview_img.shape[2] == 3:  # RGB to BGR for cv2
                    preview_img = cv2.cvtColor(preview_img, cv2.COLOR_RGB2BGR)
                cv2.imwrite(preview_path, preview_img)
                job.preview_file = os.path.basename(preview_path)
                preview_saved = True
        
        # Close reader and writer
        reader.close()
        writer.close()
        
        # If we didn't save a preview yet, use the last frame
        if not preview_saved and total_frames > 0:
            # Try to extract a frame for preview
            cap = cv2.VideoCapture(input_path)
            # Seek to 1/4 of the video
            cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 4)
            ret, frame = cap.read()
            if ret:
                # Resize for preview if needed
                height, width = frame.shape[:2]
                max_size = 800  # Max dimension for preview
                
                if height > width and height > max_size:
                    new_height = max_size
                    new_width = int(width * (max_size / height))
                    frame = cv2.resize(frame, (new_width, new_height))
                elif width > height and width > max_size:
                    new_width = max_size
                    new_height = int(height * (max_size / width))
                    frame = cv2.resize(frame, (new_width, new_height))
                
                # Save preview
                cv2.imwrite(preview_path, frame)
                job.preview_file = os.path.basename(preview_path)
            cap.release()
        
        # Update job status
        job.status = "completed"
        job.progress = 100
        job.output_file = os.path.basename(output_path)
        
        logger.info(f"Video processing completed: {job_id}")
    
    except Exception as e:
        logger.error(f"Error processing video {job_id}: {str(e)}")
        job.status = "failed"
        job.error = str(e)

@app.post("/api/extract-frames")
async def extract_frames(
    background_tasks: BackgroundTasks,
    file_id: str = Form(...),
    filename: str = Form(...),
    time_interval: float = Form(0.2),
    folder_prefix: str = Form("HAND")
):
    """Extract frames from a video at specific intervals"""
    # Generate job ID
    job_id = str(uuid.uuid4())
    
    # Find the uploaded file
    file_extension = os.path.splitext(filename)[1]
    input_path = UPLOAD_DIR / f"{file_id}{file_extension}"
    
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    
    # Create output directory for frames
    output_dir = PROCESSED_DIR / f"{job_id}_frames"
    output_dir.mkdir(exist_ok=True)
    
    # Create preview path for a sample frame
    preview_filename = f"{job_id}_preview.jpg"
    preview_path = PROCESSED_DIR / preview_filename
    
    # Create job info with basic options
    options = AnonymizationOptions(
        method="none",  # Just extract, don't anonymize
        threshold=0.2,
        maskScale=1.3,
        blurIntensity=5,
        mosaicSize=20,
        ellipse=True,
        drawScores=False,
        scale=None,
        keepAudio=False
    )
    
    # Create and store job info
    job = ProcessingJob(
        id=job_id,
        filename=filename,
        status="queued",
        created=datetime.now(),
        options=options,
        output_file=str(output_dir)
    )
    active_jobs[job_id] = job
    
    # Start background processing task
    background_tasks.add_task(
        extract_frames_task,
        job_id=job_id,
        input_path=str(input_path),
        output_dir=str(output_dir),
        preview_path=str(preview_path),
        time_interval=time_interval,
        folder_prefix=folder_prefix
    )
    
    return {"job_id": job_id}

async def extract_frames_task(
    job_id: str, 
    input_path: str, 
    output_dir: str, 
    preview_path: str,
    time_interval: float,
    folder_prefix: str
):
    """Background task to extract frames from a video"""
    job = active_jobs[job_id]
    job.status = "processing"
    
    try:
        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {input_path}")
        
        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Calculate frame interval
        frame_interval = int(fps * time_interval)
        if frame_interval < 1:
            frame_interval = 1
        
        # Extract frames
        count = 0
        frame_count = 0
        preview_saved = False
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            count += 1
            
            # Extract frame at specified intervals
            if count % frame_interval == 0:
                # Generate output filename
                time_seconds = count / fps
                frame_filename = f"{folder_prefix}_{frame_count:04d}_{time_seconds:.1f}s.jpg"
                frame_path = os.path.join(output_dir, frame_filename)
                
                # Save frame
                cv2.imwrite(frame_path, frame)
                frame_count += 1
                
                # Save a preview image if needed
                if not preview_saved and frame_count >= 5:  # Use 5th frame as preview
                    # Resize for preview if needed
                    height, width = frame.shape[:2]
                    max_size = 800  # Max dimension for preview
                    
                    if height > width and height > max_size:
                        new_height = max_size
                        new_width = int(width * (max_size / height))
                        preview_img = cv2.resize(frame, (new_width, new_height))
                    elif width > height and width > max_size:
                        new_width = max_size
                        new_height = int(height * (max_size / width))
                        preview_img = cv2.resize(frame, (new_width, new_height))
                    else:
                        preview_img = frame.copy()
                    
                    # Save preview
                    cv2.imwrite(preview_path, preview_img)
                    job.preview_file = os.path.basename(preview_path)
                    preview_saved = True
            
            # Update progress every 30 frames
            if count % 30 == 0 and total_frames > 0:
                progress = min(int((count / total_frames) * 100), 99)
                job.progress = progress
                
                # Log progress occasionally
                if count % 300 == 0:
                    logger.info(f"Extracting frames {job_id}: {progress}% ({count}/{total_frames})")
        
        # Close video
        cap.release()
        
        # If we processed frames but didn't save a preview yet, use the last frame
        if frame_count > 0 and not preview_saved:
            # Find the last frame
            last_frame_path = None
            for p in Path(output_dir).glob("*.jpg"):
                last_frame_path = p
            
            if last_frame_path:
                # Copy last frame as preview
                shutil.copy(str(last_frame_path), preview_path)
                job.preview_file = os.path.basename(preview_path)
        
        # Create a zip file of all frames
        import zipfile
        zip_path = os.path.join(PROCESSED_DIR, f"{job_id}_frames.zip")
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for file_path in Path(output_dir).glob("*.*"):
                zipf.write(file_path, arcname=file_path.name)
        
        # Update job status
        job.status = "completed"
        job.progress = 100
        job.output_file = f"{job_id}_frames.zip"
        
        logger.info(f"Frame extraction completed: {job_id}, extracted {frame_count} frames")
    
    except Exception as e:
        logger.error(f"Error extracting frames {job_id}: {str(e)}")
        job.status = "failed"
        job.error = str(e)

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a processing job"""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = active_jobs[job_id]
    return {
        "id": job.id,
        "filename": job.filename,
        "status": job.status,
        "progress": job.progress,
        "created": job.created.isoformat(),
        "output_file": job.output_file,
        "preview_file": job.preview_file,
        "error": job.error
    }

@app.get("/api/jobs/{job_id}/preview")
async def get_job_preview(job_id: str):
    """Get a preview image for a job"""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = active_jobs[job_id]
    
    if not job.preview_file:
        raise HTTPException(status_code=404, detail="Preview not available")
    
    preview_path = PROCESSED_DIR / job.preview_file
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview file not found")
    
    return FileResponse(preview_path)

@app.get("/api/jobs/{job_id}/download")
async def download_processed_file(job_id: str):
    """Download the processed file"""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = active_jobs[job_id]
    
    if not job.output_file or job.status != "completed":
        raise HTTPException(status_code=404, detail="Output file not available")
    
    output_path = PROCESSED_DIR / job.output_file
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    
    return FileResponse(
        output_path,
        filename=f"anonymized_{job.filename}",
        media_type="application/octet-stream"
    )

@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a job and its files"""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = active_jobs[job_id]
    
    # Remove preview file if it exists
    if job.preview_file:
        preview_path = PROCESSED_DIR / job.preview_file
        if preview_path.exists():
            preview_path.unlink()
    
    # Remove output file if it exists
    if job.output_file:
        output_path = PROCESSED_DIR / job.output_file
        if output_path.exists():
            if output_path.is_dir():
                shutil.rmtree(output_path)
            else:
                output_path.unlink()
    
    # Remove job from active jobs
    del active_jobs[job_id]
    
    return {"status": "deleted"}

@app.get("/api/config")
async def get_config():
    """Get available configuration options"""
    return {
        "anonymization_methods": ["blur", "solid", "mosaic", "none"],
        "scale_options": ["None", "640x360", "1280x720", "1920x1080"],
        "blur_intensity_range": {"min": 1, "max": 10, "default": 5},
        "mosaic_size_range": {"min": 5, "max": 50, "default": 20},
        "threshold_range": {"min": 0.01, "max": 0.99, "default": 0.2},
        "mask_scale_range": {"min": 1.0, "max": 2.0, "default": 1.3}
    }

@app.post("/anonymize")
async def anonymize_images_stream(
    images: List[UploadFile] = File(...),
    blur_intensity: int = Form(5)
):
    """Process multiple images with face anonymization and stream the results"""
    
    async def generate():
        for i, file in enumerate(images):
            # Read image file
            img_bytes = await file.read()
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                yield f'{json.dumps({"type": "error", "filename": file.filename, "message": "Could not read image"})}\n'
                continue
                
            # Convert BGR to RGB (opencv loads as BGR, deface expects RGB)
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            
            # Send progress update
            progress = (i / len(images)) * 100
            yield f'{json.dumps({"type": "progress", "progress": progress, "current_file": file.filename})}\n'
            
            try:
                # Configure options
                threshold = 0.2
                mask_scale = 1.3
                replacewith = "blur"
                ellipse = True
                draw_scores = False
                mosaicsize = 20
                
                # Detect faces
                dets, _ = centerface(img_rgb, threshold=threshold)
                
                # Anonymize faces
                deface.anonymize_frame(
                    dets, img_rgb, mask_scale=mask_scale,
                    replacewith=replacewith, ellipse=ellipse, 
                    draw_scores=draw_scores, replaceimg=None,
                    mosaicsize=mosaicsize,
                    blur_intensity=blur_intensity
                )
                
                # Convert back to BGR for saving
                img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
                
                # Encode as JPEG and convert to base64
                _, img_encoded = cv2.imencode('.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
                img_base64 = base64.b64encode(img_encoded).decode('utf-8')
                
                # Send processed image
                yield f'{json.dumps({"type": "result", "filename": file.filename, "image": img_base64})}\n'
                
            except Exception as e:
                logger.error(f"Error anonymizing image {file.filename}: {str(e)}")
                yield f'{json.dumps({"type": "error", "filename": file.filename, "message": str(e)})}\n'
            
            # Reset file pointer for any subsequent operations
            await file.seek(0)
        
        # Send final progress
        yield f'{json.dumps({"type": "progress", "progress": 100, "current_file": "Complete"})}\n'
    
    return StreamingResponse(generate(), media_type='text/event-stream')

# Run with: uvicorn app:app --reload
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)