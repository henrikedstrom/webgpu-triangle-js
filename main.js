
// Define shaders (WGSL)
const shaderCode = `

  @group(0) @binding(0) var<uniform> transformationMatrix: mat4x4<f32>;

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,  // Position of the vertex
    @location(0) fragColor: vec3<f32>      // Color passed to the fragment shader
  };

  @vertex
  fn vertexMain(
    @location(0) position: vec2<f32>,  // Input: position from the vertex buffer
    @location(1) color: vec3<f32>      // Input: color from the vertex buffer
  ) -> VertexOutput {

    // Convert position to vec3 to apply 4x4 matrix
    let transformedPosition = transformationMatrix * vec4<f32>(position, 0.0, 1.0);

    var output: VertexOutput;
    output.position = vec4<f32>(transformedPosition.xy, 0.0, 1.0);
    output.fragColor = color;
    return output;
  }

  @fragment
  fn fragmentMain(
    @location(0) fragColor: vec3<f32>  // Input: interpolated color from the vertex shader
  ) -> @location(0) vec4<f32> {
    return vec4<f32>(fragColor, 1.0); // Output the color with full opacity
  }
`;

// Define the vertex data
const vertexData = new Float32Array([
  // Position (x, y)      // Color (r, g, b)
   0.0,  0.6667,          1.0, 0.0, 0.0,  // Top vertex: Red
  -0.5, -0.3333,          0.0, 1.0, 0.0,  // Bottom-left vertex: Green
   0.5, -0.3333,          0.0, 0.0, 1.0,  // Bottom-right vertex: Blue
]);

function createTransformationMatrix(rotation, tx, ty) {
  const cosTheta = Math.cos(rotation);
  const sinTheta = Math.sin(rotation);

  return new Float32Array([
    cosTheta, -sinTheta, 0.0, 0.0, // First column
    sinTheta,  cosTheta, 0.0, 0.0, // Second column
    0.0,       0.0,      1.0, 0.0, // Third column (Z-axis)
    tx,        ty,       0.0, 1.0, // Fourth column (Translation)
  ]);
}

async function initWebGPU() {

  // Get the canvas and its WebGPU context
  const canvas = document.getElementById('gpuCanvas');

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance'
  });
  if (!adapter) {
    console.error('WebGPU adapter not available. Your hardware or browser may not support WebGPU.');
    return;
  }
  
  const device = await adapter.requestDevice();
  if (!device) {
    console.error('Failed to create WebGPU device.');
    return;
  }

  const context = canvas.getContext('webgpu');

  // Define the format for rendering
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });

  // Create the shader module
  const shaderModule = device.createShaderModule({ code: shaderCode });

  // Create the vertex buffer
  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });

  new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
  vertexBuffer.unmap();

  // Create the pipeline
  const pipeline = device.createRenderPipeline({
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          {
            shaderLocation: 0, // Position: Matches @location(0) in the shader
            format: 'float32x2', // vec2<f32>
            offset: 0, // Start at the beginning of each vertex
          },
          {
            shaderLocation: 1, // Color: Matches @location(1) in the shader
            format: 'float32x3', // vec3<f32>
            offset: 2 * Float32Array.BYTES_PER_ELEMENT, // Start after position
          },
        ],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
    layout: 'auto',
  });

  // Create the uniform buffer
  const uniformBuffer = device.createBuffer({
    size: 256, // Uniform buffers must be aligned to 256 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  // Create a bind group to bind the uniform buffer to the shader
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });

  // Create the render pass descriptor
  const renderPassDescriptor = {
    colorAttachments: [{
      view: undefined, // Assigned per-frame
      loadOp: 'clear',
      clearValue: { r: 0.0, g: 0.2, b: 0.4, a: 1.0 }, // Light blue background
      storeOp: 'store',
    }],
  };

  // Rotation for the triangle
  let rotationAngle = 0;
  let isRotating = true; // Track whether the rotation is active

  // Toggle rotation state on canvas click
  canvas.addEventListener('click', () => {
    isRotating = !isRotating; // Toggle the rotation state
  });

  // Rendering loop
  function frame() {

    // Calculate the transformation matrix
    if (isRotating) {
      rotationAngle += 0.01; // Increment the angle for smooth rotation
      const tx = 0.0; // Center of the screen (already normalized to [-1, 1])
      const ty = 0.0;
      const transformationMatrix = createTransformationMatrix(rotationAngle, tx, ty);

      // Write the rotation matrix to the uniform buffer
      device.queue.writeBuffer(uniformBuffer, 0, transformationMatrix);
    }
    
    // Get the current texture from the canvas
    const currentTexture = context.getCurrentTexture();
    renderPassDescriptor.colorAttachments[0].view = currentTexture.createView();

    // Create the command encoder
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    // Issue drawing commands
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup); // Bind the uniform buffer
    passEncoder.setVertexBuffer(0, vertexBuffer); // Bind the vertex buffer
    passEncoder.draw(3);
    passEncoder.end();

    // Submit the command buffer
    device.queue.submit([commandEncoder.finish()]);

    // Request the next animation frame
    requestAnimationFrame(frame);
  }

  // Start rendering
  frame();
}

// Initialize WebGPU
if (navigator.gpu) {
  initWebGPU();
} else {
  console.error('WebGPU is not supported on this browser.');
}
