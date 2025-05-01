import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import JSZip from 'jszip'; // You'll need to install this: npm install jszip

function App() {
  const [activeTab, setActiveTab] = useState('welcome');
  
  // Create separate state for each tab's files
  const [videoFiles, setVideoFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  
  // Create separate refs for each tab's file input
  const fileInputVideoRef = useRef(null);
  const fileInputImageRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileInputImageFolderRef = useRef(null);
  const cancellingRef = useRef(false);

  // File handlers for each tab
  const handleVideoFileSelect = (event) => {
    const files = Array.from(event.target.files);
    
    // Only process if files were actually selected
    if (files.length === 0) return;
    
    // Filter only video files
    const validVideoFiles = files.filter(file => file.type.startsWith('video/'));
    
    if (validVideoFiles.length < files.length) {
      alert('Only video files are allowed for video anonymization. Some files were not included.');
    }
    
    // Only update state if valid video files were found
    if (validVideoFiles.length > 0) {
      setVideoFiles(validVideoFiles);
    }
  };

  // Update the handleImageFileSelect function with the same duplicate check
const handleImageFileSelect = (event) => {
  const files = Array.from(event.target.files);
  
  // Only process if files were actually selected
  if (files.length === 0) return;
  
  // Filter only image files
  const validImageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (validImageFiles.length < files.length) {
    alert('Only image files are allowed for image anonymization. Some files were not included.');
  }
  
  // Only add new images if valid ones were found, checking for duplicates
  if (validImageFiles.length > 0) {
    setImageFiles(prevFiles => {
      // Create a map of existing files for quick lookup
      const existingFilesMap = new Map();
      prevFiles.forEach(file => {
        const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
        existingFilesMap.set(fileKey, true);
      });
      
      // Filter out duplicates
      const uniqueNewFiles = validImageFiles.filter(file => {
        const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
        return !existingFilesMap.has(fileKey);
      });
      
      // Show notification if duplicates were found
      const duplicateCount = validImageFiles.length - uniqueNewFiles.length;
      if (duplicateCount > 0) {
        alert(`${duplicateCount} duplicate image(s) were skipped.`);
      }
      
      return [...prevFiles, ...uniqueNewFiles];
    });
  }
};

  // Update the handleFileSelect function to prevent uploads during extraction
const handleFileSelect = (event) => {
  if (isExtracting) {
    alert('Please wait until the current frame extraction is complete before uploading new videos.');
    event.target.value = ''; // Reset the file input
    return;
  }
  
  const files = Array.from(event.target.files);
  
  // Only process and clear previous results if files were actually selected
  if (files.length === 0) return;
  
  // Filter only video files
  const videoFiles = files.filter(file => {
    return file.type.startsWith('video/');
  });
  
  if (videoFiles.length < files.length) {
    alert('Only video files are allowed for frame extraction. Some files were not included.');
  }
  
  // Only update state if valid video files were found
  if (videoFiles.length > 0) {
    setSelectedFiles(videoFiles);
    
    // Reset extraction state when new files are selected
    setExtractionComplete(false);
    setExtractedFrames({});
  }
};

  // Trigger functions for each file input
  const triggerVideoFileInput = () => {
    fileInputVideoRef.current.click();
  };

  const triggerImageFileInput = () => {
    fileInputImageRef.current.click();
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // Update the handler for folder selection to check for duplicates
const handleImageFolderSelect = (event) => {
  const files = Array.from(event.target.files);
  
  // Only process if files were actually selected
  if (files.length === 0) return;
  
  // Filter only image files from the selected folders
  const validImageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (validImageFiles.length === 0) {
    alert('No image files found in the selected folders.');
    return;
  }
  
  // Check for duplicates before adding
  setImageFiles(prevFiles => {
    // Create a map of existing files for quick lookup
    const existingFilesMap = new Map();
    prevFiles.forEach(file => {
      // Create a unique key based on name, size and last modified date
      const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
      existingFilesMap.set(fileKey, true);
    });
    
    // Filter out duplicates
    const uniqueNewFiles = validImageFiles.filter(file => {
      const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
      return !existingFilesMap.has(fileKey);
    });
    
    // Show notification if duplicates were found
    const duplicateCount = validImageFiles.length - uniqueNewFiles.length;
    if (duplicateCount > 0) {
      alert(`${duplicateCount} duplicate image(s) were skipped.`);
    }
    
    // Return new state with only unique files added
    return [...prevFiles, ...uniqueNewFiles];
  });
};

  // Function to process dropped items (files or folders)
  const processDroppedItems = async (items, setFilesFunction) => {
    const imageFiles = [];
    const processItem = async (item) => {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          if (entry.isFile) {
            // Handle file
            const file = await new Promise(resolve => {
              entry.file(file => resolve(file));
            });
            if (file.type.startsWith('image/')) {
              imageFiles.push(file);
            }
          } else if (entry.isDirectory) {
            // Handle directory
            const dirReader = entry.createReader();
            const entries = await new Promise(resolve => {
              dirReader.readEntries(entries => resolve(entries));
            });
            for (const childEntry of entries) {
              await processItem({ webkitGetAsEntry: () => childEntry });
            }
          }
        }
      }
    };
    
    for (let i = 0; i < items.length; i++) {
      await processItem(items[i]);
    }
    
    if (imageFiles.length === 0) {
      alert('No image files found in the dropped items.');
      return;
    }
    
    // Add new images to existing ones
    setFilesFunction(prevFiles => [...prevFiles, ...imageFiles]);
  };

  // New state for frame extraction
  const [frameInterval, setFrameInterval] = useState(0.2);
  const [frameQuality, setFrameQuality] = useState(100);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractionComplete, setExtractionComplete] = useState(false);
  const [currentProcessingVideo, setCurrentProcessingVideo] = useState('');
  const [extractedFrames, setExtractedFrames] = useState({});
  
  // Add these state variables to your App component
  const [isAnonymizing, setIsAnonymizing] = useState(false);
  const [anonymizationProgress, setAnonymizationProgress] = useState(0);
  const [anonymizationComplete, setAnonymizationComplete] = useState(false);
  const [anonymizedImages, setAnonymizedImages] = useState([]);
  const [currentProcessingImage, setCurrentProcessingImage] = useState('');
  const [blurIntensity, setBlurIntensity] = useState(5); // 1-10 scale (1=strongest, 10=weakest)

  // Add these state variables for video anonymization
  const [isVideoAnonymizing, setIsVideoAnonymizing] = useState(false);
  const [videoAnonymizationJobs, setVideoAnonymizationJobs] = useState([]);
  const [videoBlurIntensity, setVideoBlurIntensity] = useState(5);
  const [videoProcessingProgress, setVideoProcessingProgress] = useState({});

  // Add this near your other state variables
const [isCancelling, setIsCancelling] = useState(false);

// Add this near your other state variables
const [isImageCancelling, setIsImageCancelling] = useState(false);
const imageCancellingRef = useRef(false);

// Add this function to clear all selected image files
const clearImageFiles = () => {
  setImageFiles([]);
  setAnonymizationComplete(false);
  setAnonymizedImages([]);
  
  // Reset the file input values so the same files/folders can be selected again
  if (fileInputImageRef.current) {
    fileInputImageRef.current.value = '';
  }
  if (fileInputImageFolderRef.current) {
    fileInputImageFolderRef.current.value = '';
  }
};

// Update the extractFrames function to support cancellation
const extractFrames = async () => {
  if (selectedFiles.length === 0) return;
  
  setIsExtracting(true);
  setExtractionProgress(0);
  setExtractionComplete(false);
  setExtractedFrames({});
  setIsCancelling(false);
  cancellingRef.current = false; // Reset cancellation flag
  
  const framesByVideo = {};
  let overallProgress = 0;
  
  for (let i = 0; i < selectedFiles.length; i++) {
    // Check if cancellation was requested
    if (cancellingRef.current) {
      console.log("Frame extraction cancelled");
      break;
    }
    
    const videoFile = selectedFiles[i];
    const videoName = videoFile.name.replace(/\.[^/.]+$/, ""); // Remove extension
    setCurrentProcessingVideo(videoName);
    
    const frames = await extractFramesFromVideo(
      videoFile, 
      frameInterval, 
      frameQuality,
      (progress) => {
        // Only update progress if not cancelling
        if (!cancellingRef.current) {
          const videoProgressWeight = 1 / selectedFiles.length;
          const currentVideoProgress = progress * videoProgressWeight;
          const previousVideosProgress = (i / selectedFiles.length) * 100;
          setExtractionProgress(previousVideosProgress + currentVideoProgress);
        }
      },
      // Pass reference to cancellation flag
      () => cancellingRef.current
    );
    
    // If cancellation was requested during extraction, stop processing more videos
    if (cancellingRef.current) {
      break;
    }
    
    framesByVideo[videoName] = frames;
    overallProgress = ((i + 1) / selectedFiles.length) * 100;
    setExtractionProgress(overallProgress);
  }
  
  // Only set as complete if not cancelled
  if (!cancellingRef.current) {
    setExtractedFrames(framesByVideo);
    setExtractionComplete(true);
  }
  
  // Always reset extraction and cancelling states
  setIsExtracting(false);
  setIsCancelling(false);
  cancellingRef.current = false;
};

// Update extractFramesFromVideo to accept a cancellationCheck function
const extractFramesFromVideo = (videoFile, interval, quality, progressCallback, cancellationCheck) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];
    
    // Handle cancellation during video loading
    const checkCancellationInterval = setInterval(() => {
      if (cancellationCheck()) {
        clearInterval(checkCancellationInterval);
        video.src = '';
        video.load(); // Stop video loading
        URL.revokeObjectURL(video.src);
        resolve(frames);
      }
    }, 100);
    
    // Set up video metadata loading
    video.onloadedmetadata = () => {
      clearInterval(checkCancellationInterval); // Clear the interval once metadata is loaded
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const videoDuration = video.duration;
      const frameCount = Math.floor(videoDuration / interval);
      
      let currentFrame = 0;
      let extractionTimeout;
      
      // Function to extract a single frame
      const extractFrame = () => {
        // Check if cancellation was requested
        if (cancellationCheck()) {
          if (extractionTimeout) clearTimeout(extractionTimeout);
          URL.revokeObjectURL(video.src);
          video.src = ''; // Release resources
          resolve(frames); // Return whatever frames we've collected so far
          return;
        }
        
        if (currentFrame >= frameCount) {
          URL.revokeObjectURL(video.src);
          video.src = ''; // Release resources
          resolve(frames);
          return;
        }
        
        const currentTime = currentFrame * interval;
        
        // Use timeout to make cancellation more responsive
        extractionTimeout = setTimeout(() => {
          video.currentTime = currentTime;
        }, 0);
      };
      
      // When video time updates, extract the frame
      video.ontimeupdate = () => {
        // Check again for cancellation
        if (cancellationCheck()) {
          URL.revokeObjectURL(video.src);
          video.src = ''; // Release resources
          resolve(frames);
          return;
        }
        
        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to image data
        const imgData = canvas.toDataURL('image/jpeg', quality / 100);
        frames.push(imgData);
        
        // Update progress
        currentFrame++;
        progressCallback((currentFrame / frameCount) * 100);
        
        // Add a small delay to make the process more cancellable
        extractionTimeout = setTimeout(() => extractFrame(), 0);
      };
      
      // Start extraction
      extractFrame();
    };
    
    // Handle errors
    video.onerror = () => {
      clearInterval(checkCancellationInterval);
      console.error("Error loading video");
      resolve([]);
    };
    
    // Load video
    video.src = URL.createObjectURL(videoFile);
    video.load();
  });
};
  
  // Function to download extracted frames as ZIP files
  const downloadFrames = () => {
    if (Object.keys(extractedFrames).length === 0) return;
    
    // Create zip files - one for each video
    const zip = new JSZip();
    
    // Add frames from each video to their own folder
    Object.keys(extractedFrames).forEach(videoName => {
      const videoFolder = zip.folder(videoName);
      const frames = extractedFrames[videoName];
      
      frames.forEach((frame, index) => {
        // Convert base64 to binary
        const data = frame.split(',')[1];
        videoFolder.file(`frame_${(index + 1).toString().padStart(5, '0')}.jpg`, data, {base64: true});
      });
    });
    
    // Generate and download the zip file
    zip.generateAsync({type: 'blob'})
      .then(content => {
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'extracted_frames.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
  };

// Add this function to handle image anonymization
const anonymizeImages = async () => {
  if (imageFiles.length === 0) return;
  
  setIsAnonymizing(true);
  setAnonymizationProgress(0);
  setAnonymizationComplete(false);
  setAnonymizedImages([]);
  setIsImageCancelling(false);
  imageCancellingRef.current = false;
  
  const formData = new FormData();
  imageFiles.forEach(file => {
    formData.append('images', file);
  });
  formData.append('blur_intensity', blurIntensity.toString());
  
  // Create an AbortController for cancelling the fetch
  const controller = new AbortController();
  const signal = controller.signal;
  
  try {
    // Update to match your FastAPI server URL and port (8000)
    const response = await fetch('http://localhost:8000/anonymize', {
      method: 'POST',
      body: formData,
      signal: signal // Add the abort signal
    });
    
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    
    // Read progress using event stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      // Check for cancellation
      if (imageCancellingRef.current) {
        reader.cancel();
        console.log("Image anonymization cancelled");
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim() === '') continue;
        
        try {
          const data = JSON.parse(line);
          if (data.type === 'progress') {
            setAnonymizationProgress(data.progress);
            setCurrentProcessingImage(data.current_file);
          } else if (data.type === 'result') {
            // Check for cancellation before processing result
            if (imageCancellingRef.current) break;
            
            // Process completed image
            const blob = await fetch(`data:image/jpeg;base64,${data.image}`).then(r => r.blob());
            // Try to find matching file by exact match first, then by filename without path
            const originalFile = imageFiles.find(f => f.name === data.filename) || 
                                imageFiles.find(f => data.filename.endsWith(f.name));
            setAnonymizedImages(prev => [...prev, {
              original: originalFile,
              anonymized: URL.createObjectURL(blob),
              name: data.filename
            }]);
          }
        } catch (e) {
          console.error('Error parsing progress data:', e);
        }
      }
    }
    
    // Only set as complete if not cancelled
    if (!imageCancellingRef.current) {
      setAnonymizationComplete(true);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Image anonymization was cancelled');
    } else {
      console.error('Error during anonymization:', error);
      alert('Error during anonymization: ' + error.message);
    }
  } finally {
    setIsAnonymizing(false);
    setIsImageCancelling(false);
    imageCancellingRef.current = false;
  }
};

// Function to download anonymized images
const downloadAnonymizedImages = () => {
  if (anonymizedImages.length === 0) return;
  
  const zip = new JSZip();
  const folder = zip.folder("anonymized_images");
  
  // Track promise completions
  const promises = [];
  
  anonymizedImages.forEach((item) => {
    const promise = fetch(item.anonymized)
      .then(res => res.blob())
      .then(blob => {
        folder.file(item.name, blob);
      });
    promises.push(promise);
  });
  
  // Once all files are added to the zip
  Promise.all(promises).then(() => {
    zip.generateAsync({type: 'blob'})
      .then(content => {
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'anonymized_images.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
  });
};

// Add these functions for video processing
const anonymizeVideos = async () => {
  if (videoFiles.length === 0) return;
  
  setIsVideoAnonymizing(true);
  setVideoAnonymizationJobs([]); // Clear any previous jobs
  setVideoProcessingProgress({}); // Clear progress
  
  const jobs = [];
  
  for (const videoFile of videoFiles) {
    try {
      console.log(`Starting upload for ${videoFile.name}...`);
      
      // Step 1: Upload the video file
      const uploadFormData = new FormData();
      uploadFormData.append('file', videoFile);
      
      const uploadResponse = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: uploadFormData
      });
      
      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload video: ${uploadResponse.status}`);
      }
      
      const uploadData = await uploadResponse.json();
      const fileId = uploadData.id;
      console.log(`Video ${videoFile.name} uploaded, got ID: ${fileId}`);
      
      // Step 2: Start the anonymization process
      const options = {
        method: "blur",
        threshold: 0.2,
        maskScale: 1.3,
        blurIntensity: videoBlurIntensity,
        mosaicSize: 20,
        ellipse: true,
        drawScores: false,
        keepAudio: true
      };
      
      const processFormData = new FormData();
      processFormData.append('file_id', fileId);
      processFormData.append('filename', videoFile.name);
      processFormData.append('options_json', JSON.stringify(options));
      
      console.log(`Starting processing for ${videoFile.name}...`);
      const processResponse = await fetch('http://localhost:8000/api/process/video', {
        method: 'POST',
        body: processFormData
      });
      
      if (!processResponse.ok) {
        throw new Error(`Failed to start processing video: ${processResponse.status}`);
      }
      
      const processData = await processResponse.json();
      console.log(`Processing started for ${videoFile.name}, job ID: ${processData.job_id}`);
      
      // Add job to the list
      jobs.push({
        id: processData.job_id,
        filename: videoFile.name,
        status: 'processing',
        progress: 0,
        original: videoFile
      });
      
    } catch (error) {
      console.error(`Error processing video ${videoFile.name}:`, error);
      alert(`Error processing ${videoFile.name}: ${error.message}`);
      
      // Still add failed job to list to show error
      jobs.push({
        id: `error-${Date.now()}`,
        filename: videoFile.name,
        status: 'failed',
        error: error.message,
        original: videoFile
      });
    }
  }
  
  // Update state with initial jobs
  setVideoAnonymizationJobs(jobs);
  
  // Start polling for job status updates
  if (jobs.length > 0) {
    pollJobStatus(jobs);
  } else {
    setIsVideoAnonymizing(false);
  }
};

const pollJobStatus = async (initialJobs) => {
  // Store a reference to the jobs passed in during first call
  let jobs = [...initialJobs];
  
  const pollInterval = setInterval(async () => {
    let allComplete = true;
    const updatedJobs = [...jobs]; // Use the local copy that we update each interval
    const progressUpdate = {...videoProcessingProgress};
    
    for (let i = 0; i < updatedJobs.length; i++) {
      const job = updatedJobs[i];
      
      if (job.status !== 'completed' && job.status !== 'failed') {
        try {
          const response = await fetch(`http://localhost:8000/api/jobs/${job.id}`);
          if (response.ok) {
            const jobData = await response.json();
            
            console.log(`Job ${job.id} status:`, jobData); // Add logging
            
            updatedJobs[i] = {
              ...job,
              status: jobData.status,
              progress: jobData.progress,
              output_file: jobData.output_file,
              error: jobData.error
            };
            
            progressUpdate[job.id] = jobData.progress;
            
            if (jobData.status !== 'completed' && jobData.status !== 'failed') {
              allComplete = false;
            }
          } else {
            console.error(`Error polling job ${job.id}: Server returned ${response.status}`);
            // Keep polling even if there's an error
            allComplete = false;
          }
        } catch (error) {
          console.error(`Error polling job status for ${job.id}:`, error);
          // Keep polling even if there's an error
          allComplete = false;
        }
      }
    }
    
    jobs = updatedJobs; // Update our local copy
    setVideoAnonymizationJobs(updatedJobs);
    setVideoProcessingProgress(progressUpdate);
    
    console.log('Updated jobs:', updatedJobs);
    console.log('All complete:', allComplete);
    
    if (allComplete) {
      clearInterval(pollInterval);
      setIsVideoAnonymizing(false);
    }
  }, 2000); // Poll every 2 seconds
  
  // Cleanup function to clear interval if component unmounts
  return () => clearInterval(pollInterval);
};

const downloadAnonymizedVideo = async (jobId, filename) => {
  try {
    const response = await fetch(`http://localhost:8000/api/jobs/${jobId}/download`);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `anonymized_${filename}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(`Error downloading video:`, error);
    alert(`Error downloading video: ${error.message}`);
  }
};

  // Add this effect to handle the beforeunload event
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isExtracting && !isCancelling) {
        // Standard way to show a confirmation dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = 'Frame extraction is in progress. Are you sure you want to leave?';
        return 'Frame extraction is in progress. Are you sure you want to leave?';
      }
    };

    // Add the event listener if extraction is in progress
    if (isExtracting) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // Clean up function to remove the event listener
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isExtracting, isCancelling]);

  // Add this effect to handle the beforeunload event for image anonymization
  useEffect(() => {
    const handleBeforeUnloadForImages = (e) => {
      if (isAnonymizing) {
        // Standard way to show a confirmation dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = 'Image anonymization is in progress. Leaving now will cancel the process.';
        return 'Image anonymization is in progress. Leaving now will cancel the process.';
      }
    };

    // Add the event listener if anonymization is in progress
    if (isAnonymizing) {
      window.addEventListener('beforeunload', handleBeforeUnloadForImages);
    }

    // Clean up function to remove the event listener
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnloadForImages);
    };
  }, [isAnonymizing]);

  return (
    <div className="app-container">
      {/* Header */}
      {/* <header className="header">
        <div className="container">
          <h1 className="logo">Privacy Lens</h1>
        </div>
      </header> */}

      {/* Navigation */}
      <nav className="nav">
  <div className="container">
    <div className="nav-container">
      <div className="nav-logo">
        <img 
          src="/mable_logo.png" 
          alt="MABLE Logo" 
          className="nav-mable-logo" 
        />
      </div>
      <div className="nav-items">
        <button 
          className={`nav-button ${activeTab === 'welcome' ? 'active' : ''}`}
          onClick={() => setActiveTab('welcome')}
        >
          Welcome
        </button>
        <button
          className={`nav-button ${activeTab === 'video' ? 'active' : ''}`}
          onClick={() => setActiveTab('video')}
        >
          Video Anonymization
        </button>
        <button
          className={`nav-button ${activeTab === 'image' ? 'active' : ''}`}
          onClick={() => setActiveTab('image')}
        >
          Image Anonymization
        </button>
        <button
          className={`nav-button ${activeTab === 'frames' ? 'active' : ''}`}
          onClick={() => setActiveTab('frames')}
        >
          Frame Extraction
        </button>
      </div>
    </div>
  </div>
</nav>

      {/* Main content */}
      <main className="main-content">
        <div className="container">
          {activeTab === 'welcome' && (
  <div className="welcome-screen">
    <h1 className="title">Privacy Lens</h1>
    <h2 className="subtitle">Web-based Face Anonymization Tool</h2>
    <p className="description">
      This tool allows you to anonymize faces in videos and images. Upload your files, customize anonymization options, and download the processed results.
    </p>
    
    <div className="feature-cards">
      <div 
        className="feature-card"
        onClick={() => setActiveTab('video')}
      >
        <h3 className="feature-title">Video Anonymization</h3>
        <p className="feature-description">Process videos to anonymize all faces</p>
      </div>
      
      <div 
        className="feature-card"
        onClick={() => setActiveTab('image')}
      >
        <h3 className="feature-title">Image Anonymization</h3>
        <p className="feature-description">Process images to anonymize all faces</p>
      </div>
      
      <div 
        className="feature-card"
        onClick={() => setActiveTab('frames')}
      >
        <h3 className="feature-title">Frame Extraction</h3>
        <p className="feature-description">Extract frames from videos at specific intervals</p>
      </div>
    </div>
  </div>
)}

          {activeTab === 'video' && (
            <div>
              <h2 className="section-title">Video Anonymization</h2>
              <p>Process videos to anonymize all faces</p>
              
              <div 
                className="upload-area"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  const files = Array.from(e.dataTransfer.files);
                  const videoFiles = files.filter(file => file.type.startsWith('video/'));
                  
                  if (videoFiles.length < files.length) {
                    alert('Only video files are allowed for video anonymization. Some files were not included.');
                  }
                  
                  setVideoFiles(videoFiles);
                }}
              >
                <p className="upload-text">Drag and drop video files here, or click to select files</p>
                <input
                  type="file"
                  ref={fileInputVideoRef}
                  onChange={handleVideoFileSelect}
                  accept="video/*"
                  style={{ display: 'none' }}
                  multiple
                />
                <button className="button primary-button" onClick={triggerVideoFileInput}>
                  Select Files
                </button>
              </div>
              
              {videoFiles.length > 0 && (
                <div className="selected-files">
                  <h3>Selected Files:</h3>
                  <ul>
                    {videoFiles.map((file, index) => (
                      <li key={index}>{file.name}</li>
                    ))}
                  </ul>
                  
                  <div className="anonymization-options">
                    <h3>Anonymization Options</h3>
                    <div className="option">
                      <label htmlFor="video-blur-intensity">Blur Intensity (1-10):</label>
                      <input 
                        type="range" 
                        id="video-blur-intensity" 
                        min="1" 
                        max="10" 
                        value={videoBlurIntensity}
                        className="range-slider"
                        onChange={(e) => setVideoBlurIntensity(parseInt(e.target.value))}
                      />
                      <span className="range-value">{videoBlurIntensity}</span>
                      <p className="option-description">
                        {videoBlurIntensity < 4 ? "Strong blur" : videoBlurIntensity < 8 ? "Medium blur" : "Light blur"}
                      </p>
                    </div>
                  </div>
                  
                  <div className="anonymization-actions">
                    <button 
                      className="button primary-button"
                      onClick={anonymizeVideos}
                      disabled={isVideoAnonymizing}
                    >
                      {isVideoAnonymizing ? 'Processing...' : 'Anonymize Videos'}
                    </button>
                  </div>
                </div>
              )}
              
              {videoAnonymizationJobs.length > 0 && (
                <div className="video-jobs">
                  <div className="debug-controls">
                    <button 
                      className="button secondary-button small"
                      onClick={() => {
                        console.log('Current jobs:', videoAnonymizationJobs);
                        console.log('Progress state:', videoProcessingProgress);
                      }}
                    >
                      Debug State
                    </button>
                  </div>
                  <h3>Processing Jobs:</h3>
                  <div className="job-list">
                    {videoAnonymizationJobs.map((job) => (
                      <div key={job.id} className="job-item">
                        <div className="job-info">
                          <p className="job-filename">{job.filename}</p>
                          
                          {job.status === 'processing' ? (
                            <>
                              <div className="status-indicator">
                                <div className="status-dot"></div>
                                <span>Processing video...</span>
                              </div>
                              <div className="loading-bar-container">
                                <div className="loading-bar"></div>
                              </div>
                            </>
                          ) : (
                            <p className="job-status">Status: {job.status}</p>
                          )}
                          
                          {job.status === 'completed' && (
                            <button 
                              className="button success-button"
                              onClick={() => downloadAnonymizedVideo(job.id, job.filename)}
                            >
                              Download Anonymized Video
                            </button>
                          )}
                          
                          {job.status === 'failed' && (
                            <p className="job-error">Error: {job.error || 'Unknown error'}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'image' && (
            <div>
              <h2 className="section-title">Image Anonymization</h2>
              <p>Process images to anonymize all faces</p>
              
              <div className="upload-options">
                <div className="option-buttons">
                  <button className="button secondary-button" onClick={() => fileInputImageRef.current.click()}>
                    Select Files
                  </button>
                  <button className="button secondary-button" onClick={() => fileInputImageFolderRef.current.click()}>
                    Select Folders
                  </button>
                </div>
                
                <div 
                  className="upload-area"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const items = e.dataTransfer.items;
                    if (items) {
                      // Process dropped items (files or folders)
                      processDroppedItems(items, setImageFiles);
                    }
                  }}
                >
                  <p className="upload-text">Drag and drop image files or folders here</p>
                  
                  {/* Hidden input for selecting individual files */}
                  <input
                    type="file"
                    ref={fileInputImageRef}
                    onChange={handleImageFileSelect}
                    accept="image/*"
                    style={{ display: 'none' }}
                    multiple
                  />
                  
                  {/* Hidden input for selecting folders */}
                  <input
                    type="file"
                    ref={fileInputImageFolderRef}
                    onChange={handleImageFolderSelect}
                    webkitdirectory=""
                    directory=""
                    style={{ display: 'none' }}
                    multiple
                  />
                </div>
              </div>
              
              {imageFiles.length > 0 && (
  <div className="selected-files">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h3>Selected Files: {imageFiles.length} images</h3>
      <button 
        className="button secondary-button"
        onClick={clearImageFiles}
        disabled={isAnonymizing}
      >
        Clear All
      </button>
    </div>
    <ul className="file-list">
      {imageFiles.slice(0, 10).map((file, index) => (
        <li key={index}>{file.name}</li>
      ))}
      {imageFiles.length > 10 && <li>...and {imageFiles.length - 10} more</li>}
    </ul>
    
    <div className="anonymization-options">
      <h3>Anonymization Options</h3>
      <div className="option">
        <label htmlFor="blur-intensity">Blur Intensity (1-10):</label>
        <input 
          type="range" 
          id="blur-intensity" 
          min="1" 
          max="10" 
          value={blurIntensity}
          className="range-slider"
          onChange={(e) => setBlurIntensity(parseInt(e.target.value))}
          disabled={isAnonymizing} // Disable slider during anonymization
        />
        <span className="range-value">{blurIntensity}</span>
        <p className="option-description">
          {blurIntensity < 4 ? "Strong blur" : blurIntensity < 8 ? "Medium blur" : "Light blur"}
        </p>
      </div>
    </div>
    
    <div className="anonymization-actions">
      <button 
        className="button primary-button"
        onClick={anonymizeImages}
        disabled={isAnonymizing}
      >
        {isAnonymizing ? 'Processing...' : 'Anonymize Images'}
      </button>
      
      {anonymizationComplete && (
        <div className="anonymization-complete">
          <p>Anonymization complete!</p>
          <button 
            className="button success-button"
            onClick={downloadAnonymizedImages}
          >
            Download Anonymized Images
          </button>
        </div>
      )}
    </div>
  </div>
)}
              
              {isAnonymizing && (
                <div className="anonymization-progress">
                  <h3>Anonymization Progress</h3>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${anonymizationProgress}%` }}></div>
                  </div>
                  <p>{anonymizationProgress.toFixed(1)}% complete</p>
                  <p>Processing image: {currentProcessingImage}</p>
                  
                  {/* Add cancel button */}
                  <button 
                    className="button danger-button"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to cancel image anonymization?")) {
                        setIsImageCancelling(true);
                        imageCancellingRef.current = true;
                      }
                    }}
                    disabled={isImageCancelling}
                  >
                    {isImageCancelling ? 'Cancelling...' : 'Cancel Anonymization'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'frames' && (
            <div>
              <h2 className="section-title">Frame Extraction</h2>
              <p>Extract frames from videos at specific intervals</p>
              
              <div 
                className="upload-area"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  if (isExtracting) {
                    alert('Please wait until the current frame extraction is complete before uploading new videos.');
                    return;
                  }
                  
                  const files = Array.from(e.dataTransfer.files);
                  const videoFiles = files.filter(file => file.type.startsWith('video/'));
                  
                  if (videoFiles.length < files.length) {
                    alert('Only video files are allowed for frame extraction. Some files were not included.');
                  }
                  
                  setSelectedFiles(videoFiles);
                  
                  // Reset extraction state when new files are dropped
                  setExtractionComplete(false);
                  setExtractedFrames({});
                }}
              >
                <p className="upload-text">Drag and drop video files here, or click to select files</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="video/*"
                  style={{ display: 'none' }}
                  multiple
                />
                <button 
                  className="button primary-button" 
                  onClick={() => {
                    if (isExtracting) {
                      alert('Please wait until the current frame extraction is complete before uploading new videos.');
                    } else {
                      triggerFileInput();
                    }
                  }}
                >
                  Select Files
                </button>
              </div>
              
              {selectedFiles.length > 0 && (
                <div className="selected-files">
                  <h3>Selected Files:</h3>
                  <ul>
                    {selectedFiles.map((file, index) => (
                      <li key={index}>{file.name}</li>
                    ))}
                  </ul>
                  
                  <div className="extraction-options">
                    <h3>Extraction Options</h3>
                    <div className="option">
                      <label htmlFor="frame-interval">Frame Interval (seconds):</label>
                      <input 
                        type="number" 
                        id="frame-interval" 
                        min="0.1" 
                        step="0.1" 
                        defaultValue="0.2"
                        className="form-input"
                        onChange={(e) => setFrameInterval(parseFloat(e.target.value))}
                        disabled={isExtracting} // Disable when extraction is in progress
                      />
                    </div>
                    
                    <div className="option">
                      <label htmlFor="frame-quality">Image Quality (1-100):</label>
                      <input 
                        type="number" 
                        id="frame-quality" 
                        min="1" 
                        max="100" 
                        defaultValue="100"
                        className="form-input"
                        onChange={(e) => setFrameQuality(parseInt(e.target.value))}
                        disabled={isExtracting} // Disable when extraction is in progress
                      />
                    </div>
                  </div>
                  
                  <div className="extraction-actions">
                    <button 
                      className="button primary-button"
                      onClick={extractFrames}
                      disabled={isExtracting}
                    >
                      {isExtracting ? 'Processing...' : 'Extract Frames'}
                    </button>
                    
                    {extractionComplete && (
                      <div className="extraction-complete">
                        <p>Extraction complete!</p>
                        <button 
                          className="button success-button"
                          onClick={downloadFrames}
                        >
                          Download Extracted Frames
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {isExtracting && (
                <div className="extraction-progress">
                  <h3>Extraction Progress</h3>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${extractionProgress}%` }}></div>
                  </div>
                  <p>{extractionProgress.toFixed(1)}% complete</p>
                  <p>Processing video: {currentProcessingVideo}</p>
                  
                  {/* Add cancel button */}
                  <button 
                    className="button danger-button"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to cancel frame extraction?")) {
                        setIsCancelling(true);
                        cancellingRef.current = true; // Set the ref value that will be checked
                      }
                    }}
                    disabled={isCancelling}
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel Extraction'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p className="footer-text">
            Privacy Lens Web Application © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;