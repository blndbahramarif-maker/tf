import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, RoundedBox, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Group, MathUtils } from "three";
import { createScreenTexture } from "./screenTexture";

function PhoneModel({ reduced }: { reduced: boolean }) {
  const group = useRef<Group>(null);
  const screenTexture = useMemo(() => createScreenTexture(), []);
  const baseYRotation = useRef(0.35);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (reduced) return;
    baseYRotation.current += delta * 0.12;
    const targetY = baseYRotation.current + state.pointer.x * 0.35;
    const targetX = -0.1 - state.pointer.y * 0.18;
    g.rotation.y = MathUtils.lerp(g.rotation.y, targetY, 0.05);
    g.rotation.x = MathUtils.lerp(g.rotation.x, targetX, 0.05);
  });

  return (
    <group ref={group} rotation={[-0.1, 0.35, 0]}>
      <RoundedBox args={[1.62, 3.3, 0.16]} radius={0.15} smoothness={6}>
        <meshPhysicalMaterial
          color="#150c2e"
          metalness={0.7}
          roughness={0.22}
          clearcoat={1}
          clearcoatRoughness={0.15}
          envMapIntensity={1.4}
        />
      </RoundedBox>

      <mesh position={[0, 0, 0.083]}>
        <planeGeometry args={[1.42, 2.98]} />
        <meshStandardMaterial
          map={screenTexture}
          emissive="#ffffff"
          emissiveMap={screenTexture}
          emissiveIntensity={1.05}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[0, 1.38, 0.09]}>
        <circleGeometry args={[0.045, 32]} />
        <meshBasicMaterial color="#050505" />
      </mesh>

      <mesh position={[0.82, 0.55, 0]}>
        <boxGeometry args={[0.03, 0.32, 0.05]} />
        <meshStandardMaterial color="#2a1f45" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[-0.82, 0.68, 0]}>
        <boxGeometry args={[0.03, 0.46, 0.05]} />
        <meshStandardMaterial color="#2a1f45" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

function FloatingAccessories({ reduced }: { reduced: boolean }) {
  const floatProps = reduced
    ? { speed: 0, rotationIntensity: 0, floatIntensity: 0 }
    : {};

  return (
    <>
      <Float speed={1.6} rotationIntensity={0.5} floatIntensity={1.2} {...floatProps}>
        <mesh position={[-1.3, 1.0, 0.7]} rotation={[0.25, 0.5, 0.1]}>
          <torusGeometry args={[0.26, 0.09, 24, 48]} />
          <meshPhysicalMaterial
            color="#ff8f3d"
            metalness={0.55}
            roughness={0.2}
            clearcoat={1}
            envMapIntensity={1.6}
            emissive="#ff6a1a"
            emissiveIntensity={0.18}
          />
        </mesh>
      </Float>
      <Float speed={1.1} rotationIntensity={0.35} floatIntensity={1} {...floatProps}>
        <mesh position={[1.35, -0.9, 0.7]} rotation={[0.3, 0.4, 0.1]}>
          <RoundedBox args={[0.5, 0.5, 0.12]} radius={0.11} smoothness={4}>
            <meshPhysicalMaterial
              color="#0fb8ab"
              metalness={0.4}
              roughness={0.22}
              clearcoat={0.8}
              envMapIntensity={1.5}
              emissive="#0fb8ab"
              emissiveIntensity={0.15}
            />
          </RoundedBox>
        </mesh>
      </Float>
    </>
  );
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 5]} intensity={1.3} color="#ffffff" />
      <directionalLight position={[-4, -1.5, -3]} intensity={0.7} color="#2dd4c4" />
      <Environment resolution={256}>
        <Lightformer intensity={2.4} color="#ffffff" position={[0, 4, -6]} scale={[10, 6, 1]} />
        <Lightformer intensity={1.6} color="#8b6bff" position={[-6, 1, 2]} rotation={[0, Math.PI / 2, 0]} scale={[8, 3, 1]} />
        <Lightformer intensity={1.6} color="#2dd4c4" position={[6, -1, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 3, 1]} />
      </Environment>
    </>
  );
}

export default function Hero3DScene({ reduced = false }: { reduced?: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 8.2], fov: 34 }}
      gl={{ antialias: true, alpha: true }}
      style={{ touchAction: "pan-y" }}
    >
      <Suspense fallback={null}>
        <Lighting />
        <PhoneModel reduced={reduced} />
        <FloatingAccessories reduced={reduced} />
        <ContactShadows
          position={[0, -1.75, 0]}
          opacity={0.5}
          scale={6}
          blur={2.6}
          far={3}
          resolution={512}
          color="#120a33"
        />
      </Suspense>
    </Canvas>
  );
}
