import AWS from 'aws-sdk';

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    region: process.env.REACT_APP_AWS_REGION
});

const s3 = new AWS.S3();

const uploadAudio = async (file) => {
    const fileName = `${Date.now()}-${file.name}`;
    
    const params = {
        Bucket: 'my-app-audio-files',
        Key: fileName,
        Body: file,
        ContentType: file.type,
        ACL: 'public-read'
    };

    try {
        const { Location } = await s3.upload(params).promise();
        return Location; // This is your public URL
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}; 